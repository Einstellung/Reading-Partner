// The brief's assembly on the real host: AppData, the topic-search store, the
// bindery, the library, supplements and the box. Apart from assemble.ts so that
// file stays testable.
//
// Filing (the library entry and the supplements) is injected the way the
// topic-search result builder is: the platform's functions by default, and the
// shell can hand in others with setIssueFiling. Nothing here imports reading.
//
// Two ways in: issueRunClosed, which the topic-search runs call through the
// port the shell hands them (runs-live.ts), and checkIssuesDue, on the
// collector's five-minute tick (info/program/live.ts) for the night's end and
// for anything a crash left half done. One assembly at a time.

import { callModel, resolveModel } from "../../ai/model-call";
import { appBox, randomBoxItemId } from "../../box/store";
import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { importBook, type ImportMeta } from "../../platform/app/library";
import { languageInstruction } from "../../platform/app/settings";
import { addSupplement, type SupplementRef } from "../../platform/app/supplements";
import { fetchWithRetry, interactiveRetry } from "../../platform/http/throttled-fetch";
import { bind, type FetchBytes } from "../../workshop/bindery";
import { buildSectionedEpub } from "../../workshop/bindery/build-article";
import { infoFetch } from "../../workshop/extract/http";
import type { RegisteredMaterial } from "../dossier/registry";
import { nightEndAt } from "../topic-search/nightly";
import { loadTopicSearches } from "../topic-search/store";
import { localDay } from "../topic-search/x-progress";
import { assembleDue, runClosed, type ClosedRun, type IssueDeps } from "./assemble";
import { issueExpiryMarker } from "./expiry";
import { INFO_SHELF_FILE } from "./types";
import type { GarbageMarker } from "../../housekeeper";

export interface IssueFiling {
  importBook(bytes: Uint8Array, path: string, meta: ImportMeta): Promise<{ hash: string }>;
  addSupplement(bookId: string, ref: SupplementRef): Promise<unknown>;
}

let filing: IssueFiling = { importBook, addSupplement };

/** Hand in how an issue and its originals are filed (the shell, or a test). */
export function setIssueFiling(next: Partial<IssueFiling>): void {
  filing = { ...filing, ...next };
}

const fetchBytes: FetchBytes = async (url) => {
  const res = await fetchWithRetry(url, undefined, interactiveRetry(infoFetch));
  const bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : new Uint8Array();
  return { ok: res.ok, status: res.status, bytes, contentType: res.headers.get("content-type"), url: res.url || url };
};

/** The original as a document of its own, through the bindery: a paper's PDF as served, a page or README as an EPUB. */
async function attachOriginal(bookId: string, m: RegisteredMaterial): Promise<boolean> {
  const made = await bind({ kind: "url", url: m.url }, { fetch: fetchBytes });
  if (!made.ok) return false;
  const title = (made.metadata.title || m.title || m.url).trim();
  const ext = "passedThrough" in made ? made.format : "epub";
  const entry = await filing.importBook("passedThrough" in made ? made.bytes : made.epub, `${title}.${ext}`, {
    kind: "article",
    sourceUrl: m.url,
    ...(m.author ? { byline: m.author } : {}),
    ...(m.publishedAt ? { publishedAt: m.publishedAt } : {}),
  });
  await filing.addSupplement(bookId, { hash: entry.hash, title, sourceUrl: m.url, addedAt: Date.now() });
  return true;
}

const deps: IssueDeps = {
  files: {
    read: async (path) => ((await appData.exists(path)) ? await appData.readText(path) : null),
    write: (path, content) => writeTextAtomic(path, content),
  },
  topics: async () => (await loadTopicSearches()).map((s) => ({ searchId: s.id, name: s.name, subtopics: s.subtopics })),
  activeSearchIds: async () => (await loadTopicSearches()).filter((s) => s.status === "active").map((s) => s.id),
  buildEpub: (input) => buildSectionedEpub(input),
  importBook: (bytes, fileName, meta) => filing.importBook(bytes, fileName, meta),
  attachOriginal,
  putBox: async (item) => {
    await appBox().put({ ...item, source: "run" });
  },
  newBoxItemId: randomBoxItemId,
  // The everyday tier, as the result builder writes with (topic-search/build-live.ts).
  writeOpening: ({ system, user }) =>
    callModel("prep", "plan", system, user, { signal: new AbortController().signal, onProgress: () => {} }, { spend: { caller: "info" } }),
  language: async () => languageInstruction((await resolveModel("prep")).aiLanguage),
  nightEndAt,
  now: () => Date.now(),
  today: () => localDay(Date.now()),
};

let queue: Promise<unknown> = Promise.resolve();

// Assembly and expiry both rewrite info-shelf.json, so they take turns.
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => {});
  return next;
}

/** A topic-search run closed on this device. Never throws: a failed assembly is retried by checkIssuesDue. */
export async function issueRunClosed(run: ClosedRun): Promise<void> {
  try {
    await serial(() => runClosed(deps, run));
  } catch (e) {
    console.warn("the brief could not be assembled", e);
  }
}

/** The collector's tick: the night's end, and anything left half done. Never throws. */
export async function checkIssuesDue(): Promise<void> {
  try {
    await serial(() => assembleDue(deps));
  } catch (e) {
    console.warn("the brief could not be assembled", e);
  }
}

/**
 * The expiry marker on the real host (expiry.ts). The shell registers it with
 * reading's deleteBook and the collector check, neither of which info imports.
 */
export function liveIssueExpiryMarker(ports: {
  deleteBook(bookId: string): Promise<void>;
  isCollector(): Promise<boolean>;
}): GarbageMarker {
  return issueExpiryMarker({
    ...ports,
    readShelf: () => deps.files.read(INFO_SHELF_FILE),
    writeShelf: (text) => deps.files.write(INFO_SHELF_FILE, text),
    today: localDay,
    serial,
  });
}
