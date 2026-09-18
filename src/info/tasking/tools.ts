// What a tasking run can look in (docs/63: 先查已有 cable 和稿，再采集).
//
// Three readers over what this device already holds — the cables of the last
// thirty days, the body behind one of them, and a research room's picture — plus
// the companion's own read_page for a URL those records point at. Nothing here
// searches the web: there is no search provider in this repository, and a run
// that cannot establish something says so rather than filling it in.
//
// Every store is injected, so the whole set tests over in-memory records.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../legion/execute/turn";
import { buildReadPageTool } from "../extract/read-page-tool";
import { listCableDates, loadCableDay } from "../cable/store";
import type { Cable, CableDay } from "../cable/types";
import { CABLE_DAYS, loadArticle, type CachedArticle } from "../collect/store";
import { loadPublishedBodies, type PublishedBodies } from "../boxes/publish";
import { infoFetch, type FetchFn } from "../extract/http";
import { activeLabs, loadLabs } from "../labs/store";
import type { Lab } from "../labs/types";
import { loadPicture } from "../picture/store";
import { pictureSummary } from "../picture/picture";
import type { Picture } from "../picture/types";

/** How many cables one search may answer with. */
export const CABLE_HITS_MAX = 25;

/** How much of one body a run may take in a single read. */
export const CABLE_BODY_CHARS = 12_000;

/** How much of a room's picture rides one read. Same budget the prompt gets. */
export const PICTURE_CHARS = 2_000;

export interface TaskingToolDeps {
  /** The days this device holds cables for, newest first. */
  cableDates?: () => Promise<string[]>;
  cableDay?: (date: string) => Promise<CableDay | null>;
  /** The article cache of one day; only the collecting device has one. */
  article?: (date: string, itemId: string) => Promise<CachedArticle | null>;
  /** The bodies published with the current briefing, which every device has. */
  bodies?: () => Promise<PublishedBodies | null>;
  labs?: () => Promise<Lab[]>;
  picture?: (labId: string) => Promise<Picture>;
  fetchFn?: FetchFn;
}

interface Stores {
  cableDates: () => Promise<string[]>;
  cableDay: (date: string) => Promise<CableDay | null>;
  article: (date: string, itemId: string) => Promise<CachedArticle | null>;
  bodies: () => Promise<PublishedBodies | null>;
  labs: () => Promise<Lab[]>;
  picture: (labId: string) => Promise<Picture>;
}

function stores(deps: TaskingToolDeps): Stores {
  return {
    cableDates: deps.cableDates ?? (() => listCableDates()),
    cableDay: deps.cableDay ?? ((date) => loadCableDay(date)),
    article: deps.article ?? ((date, itemId) => loadArticle(date, itemId)),
    bodies: deps.bodies ?? (() => loadPublishedBodies()),
    labs: deps.labs ?? (async () => activeLabs(await loadLabs())),
    picture: deps.picture ?? ((labId) => loadPicture(labId)),
  };
}

// --- pure ------------------------------------------------------------------

/** Whether a cable answers to these words. Case-folded, every word has to hit. */
export function cableMatches(cable: Cable, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  const hay = [cable.title, cable.summary ?? "", cable.sourceName, cable.source, cable.outside ?? ""]
    .join("\n")
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The words a query is searched as. Whitespace-split, folded, blanks dropped. */
export function queryWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/u)
    .map((w) => w.trim())
    .filter((w) => w !== "");
}

/** One cable as the run reads it in a list: enough to decide whether to open it. */
export function cableLine(cable: Cable): string {
  const rooms = cable.hits.map((h) => h.labId).join(", ");
  const parts = [
    `- [${cable.id}] ${cable.title}`,
    `  ${cable.sourceName || cable.source} · filed ${cable.date}${cable.publishedAt ? ` · published ${cable.publishedAt}` : ""}${rooms ? ` · rooms: ${rooms}` : ""}`,
  ];
  if (cable.summary) parts.push(`  ${cable.summary}`);
  return parts.join("\n");
}

// --- tools -----------------------------------------------------------------

function buildSearchCablesTool(io: Stores): AgentTool {
  return {
    name: "search_cables",
    label: (args) => args.query ? `Searching the cables for “${args.query}”` : "Searching the cables",
    effect: "read",
    description:
      "Search the cables this device holds — every item the bureau's own collection screened " +
      "and filed, for the last thirty days. Answers with each cable's id, title, source, the " +
      "day it was filed and its one-line summary. Filter by words, by research room, or by " +
      "how far back to look; with no filter at all it lists the most recent. Use the ids it " +
      "gives you with read_cable.",
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({
          description:
            "Words that must all appear in the title, summary or source name. Leave out to list everything in range.",
        }),
      ),
      lab: Type.Optional(
        Type.String({ description: "A research room id, to keep only the cables that hit it." }),
      ),
      days: Type.Optional(
        Type.Number({ description: `How many days back to look. 1 is today only; ${CABLE_DAYS} is everything kept.` }),
      ),
    }),
    execute: async (args) => {
      const query = String(args.query ?? "").trim();
      const lab = String(args.lab ?? "").trim();
      const wanted = Number(args.days);
      const span = Number.isFinite(wanted) && wanted > 0 ? Math.min(Math.floor(wanted), CABLE_DAYS) : CABLE_DAYS;
      const words = queryWords(query);
      const dates = (await io.cableDates()).slice(0, span);
      if (dates.length === 0) {
        return "No cables have been collected on this device, so there is nothing filed to search.";
      }
      const found: Cable[] = [];
      for (const date of dates) {
        const day = await io.cableDay(date).catch(() => null);
        if (!day) continue;
        for (const cable of day.cables) {
          if (lab && !cable.hits.some((h) => h.labId === lab)) continue;
          if (!cableMatches(cable, words)) continue;
          found.push(cable);
          if (found.length >= CABLE_HITS_MAX) break;
        }
        if (found.length >= CABLE_HITS_MAX) break;
      }
      const scope = `${dates.length} day${dates.length === 1 ? "" : "s"} of cables (${dates[dates.length - 1]} to ${dates[0]})`;
      if (found.length === 0) {
        return `Nothing in ${scope} matches${query ? ` "${query}"` : ""}${lab ? ` in room ${lab}` : ""}.`;
      }
      return [`${found.length} of ${scope}:`, "", ...found.map(cableLine)].join("\n");
    },
  };
}

function buildReadCableTool(io: Stores): AgentTool {
  return {
    name: "read_cable",
    label: () => "Reading a cable",
    effect: "read",
    description:
      "Read the body of one cable by its id, as the collection obtained it. Answers with the " +
      "title, source, date and URL, then the text. Some sources only ever give a summary and " +
      "the readout says so — never describe such an item as though the article itself had been " +
      "read.",
    parameters: Type.Object({
      id: Type.String({ description: "The cable id, as search_cables returned it." }),
    }),
    execute: async (args) => {
      const id = String(args.id ?? "").trim();
      if (!id) throw new Error("read_cable needs a cable id.");
      const dates = await io.cableDates();
      let cable: Cable | null = null;
      for (const date of dates) {
        const day = await io.cableDay(date).catch(() => null);
        const hit = day?.cables.find((c) => c.id === id);
        if (hit) {
          cable = hit;
          break;
        }
      }
      if (!cable) return `No cable on this device has the id ${id}. Use search_cables to find one.`;
      const head = [
        cable.title,
        `${cable.sourceName || cable.source} · filed ${cable.date}${cable.publishedAt ? ` · published ${cable.publishedAt}` : ""}`,
        cable.url,
      ];
      // The article cache is the collecting device's and is pruned with the day;
      // the published bodies travel with the briefing and are what a reader
      // device has. Whichever answers first is the same text.
      const cached = await io.article(cable.date, id).catch(() => null);
      let text = (cached?.textContent ?? "").trim();
      let summaryOnly = false;
      if (!text) {
        const published = await io.bodies().catch(() => null);
        const body = published?.bodies[id];
        text = (body?.text ?? "").trim();
        summaryOnly = !!body?.summaryOnly;
      }
      if (!text) {
        return [
          ...head,
          "",
          "The body of this cable is not on this device — it was pruned with its day, or the " +
            "source never gave one. What there is of it is the summary above; say so rather " +
            "than describing the article.",
          ...(cable.summary ? ["", cable.summary] : []),
        ].join("\n");
      }
      const body = text.length > CABLE_BODY_CHARS ? `${text.slice(0, CABLE_BODY_CHARS)}\n…[cut]` : text;
      return [
        ...head,
        ...(summaryOnly
          ? ["", "Only a summary of this item was ever obtained, not the article itself."]
          : []),
        "",
        body,
      ].join("\n");
    },
  };
}

function buildReadPictureTool(io: Stores): AgentTool {
  return {
    name: "read_picture",
    label: (args) => args.lab ? `Reading the picture for ${args.lab}` : "Reading the situation picture",
    effect: "read",
    description:
      "Read where one research room stands: what normal looks like there, what it watches, the " +
      "judgements it has made and what is still open. Called with no room it lists the open " +
      "rooms and their ids.",
    parameters: Type.Object({
      lab: Type.Optional(
        Type.String({ description: "The room's id or its name. Leave out to list the open rooms." }),
      ),
    }),
    execute: async (args) => {
      const asked = String(args.lab ?? "").trim();
      const labs = await io.labs();
      if (labs.length === 0) return "No research rooms are open on this device.";
      if (!asked) {
        return [
          "The open research rooms:",
          "",
          ...labs.map((l) => `- [${l.id}] ${l.name}`),
        ].join("\n");
      }
      const folded = asked.toLowerCase();
      const lab = labs.find((l) => l.id === asked) ?? labs.find((l) => l.name.toLowerCase() === folded);
      if (!lab) {
        return [
          `No open room answers to "${asked}". The open rooms are:`,
          "",
          ...labs.map((l) => `- [${l.id}] ${l.name}`),
        ].join("\n");
      }
      const summary = pictureSummary(await io.picture(lab.id), { maxChars: PICTURE_CHARS }).trim();
      if (!summary) return `${lab.name} [${lab.id}] has run, but nothing has been written into its picture yet.`;
      return [`${lab.name} [${lab.id}]`, "", summary].join("\n");
    },
  };
}

/** The whole tool set one tasking run is given. */
export function buildTaskingTools(deps: TaskingToolDeps = {}): AgentTool[] {
  const io = stores(deps);
  return [
    buildSearchCablesTool(io),
    buildReadCableTool(io),
    buildReadPictureTool(io),
    // The companion's own page reader, bound to the info fetch (browser UA). Not
    // a second copy: a run reading a page has to read it the way the collection
    // does, or the two would disagree about what the page says.
    buildReadPageTool({ fetchFn: deps.fetchFn ?? infoFetch }),
  ];
}
