// Opening and closing a research room from the conversation (docs/63 章程).
//
// The reader only says what they care about. The AI drafts the charter — the
// field of view, the questions, the sources the room claims — shows it on a
// card, and the reader nods or corrects it by talking. There is no form, and
// there is no page where rooms are managed: correcting a charter is a sentence,
// which is the whole reason the charter is drafted rather than filled in.
//
// So this file follows propose_topic exactly (soul/topic/propose.ts): the tool drafts a
// card and writes nothing, the card's Apply performs the writes, and a synthetic
// user turn afterwards tells the model what was filed. Nothing here touches the
// labs file.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../ai/agent";
import { activeLabs } from "../labs/labs";
import type { Lab } from "../labs/types";
import type { SourceDescriptor } from "../sources/descriptor";
import type { LabArchiveCardData, LabProposalCardData } from "../boxes/cards";

// How much of a charter's scope paragraph the roster prints per room. The whole
// paragraph is on the card and in the file; the roster is a list, and a list of
// paragraphs stops being one.
const SCOPE_LINE_CHARS = 160;

export interface LabToolDeps {
  // The conversation the proposal was made in. Carried on the card so one read
  // back off disk still says which it was.
  threadId: string;
  // Every room in the file, read when the tool is called rather than when the
  // desk was laid: a room opened earlier in this same conversation counts.
  labs(): Promise<Lab[]>;
  // The reader's sources, for resolving what a room claims. Same reason.
  sources(): Promise<SourceDescriptor[]>;
  // Surface the card. The host owns Apply; the tool never writes.
  onLabCard(card: LabProposalCardData | LabArchiveCardData): void;
}

/** One line of scope, for a roster entry. */
function scopeLine(scope: string): string {
  const first = scope.trim().split("\n")[0]?.trim() ?? "";
  return first.length > SCOPE_LINE_CHARS ? `${first.slice(0, SCOPE_LINE_CHARS - 1)}…` : first;
}

/**
 * Which sources a proposal actually claims.
 *
 * Ids first, then display names, for the same reason resolveProposedTopic
 * matches names: the model repeats what it was shown, and it was shown a source
 * roster of names. What matches neither is dropped rather than claimed — a claim
 * on a source that does not exist would quietly make the room read nothing —
 * and the caller says so in the tool result, so the model can correct itself in
 * the same turn instead of telling the reader the room follows something it
 * does not.
 */
export function resolveClaimedSources(
  raw: readonly string[],
  sources: readonly SourceDescriptor[],
): { claimed: SourceDescriptor[]; unknown: string[] } {
  const claimed: SourceDescriptor[] = [];
  const unknown: string[] = [];
  for (const entry of raw) {
    const wanted = entry.trim();
    if (!wanted) continue;
    const folded = wanted.toLowerCase();
    const hit =
      sources.find((s) => s.id === wanted) ??
      sources.find((s) => s.name.trim().toLowerCase() === folded);
    if (!hit) unknown.push(wanted);
    else if (!claimed.some((c) => c.id === hit.id)) claimed.push(hit);
  }
  return { claimed, unknown };
}

/**
 * Which room the model meant, by id or by the name it was shown. Only open rooms
 * answer: closing a closed room is not a thing to propose.
 */
export function resolveLab(raw: string, labs: readonly Lab[]): Lab | null {
  const wanted = raw.trim();
  if (!wanted) return null;
  const open = activeLabs(labs);
  const folded = wanted.toLowerCase();
  return (
    open.find((l) => l.id === wanted) ??
    open.find((l) => l.name.trim().toLowerCase() === folded) ??
    null
  );
}

/** Whether an open room already answers to this name. */
export function labNameTaken(name: string, labs: readonly Lab[]): Lab | null {
  const folded = name.trim().toLowerCase();
  return activeLabs(labs).find((l) => l.name.trim().toLowerCase() === folded) ?? null;
}

/**
 * The roster of open rooms and the standing instruction, for the companion's
 * prompt — the labs half of what topicGuidance is for topics.
 *
 * `pictures` carries a one-line summary per room where the caller has one, so
 * the roster says not only what is being followed but roughly where each room
 * stands. It is text the caller already summarized (the prompt layer stays
 * pure); a room with no entry simply prints without one.
 */
export function labGuidance(
  labs: readonly Lab[],
  sources: readonly SourceDescriptor[],
  pictures: Record<string, string> = {},
): string {
  const open = activeLabs(labs);
  const sourceName = (id: string) => sources.find((s) => s.id === id)?.name ?? id;
  const roster = open.map((l) => {
    const parts = [`- ${l.name} (id: ${l.id})`];
    const scope = scopeLine(l.charter.scope);
    if (scope) parts.push(scope);
    if (l.sources.length) parts.push(`reads: ${l.sources.map(sourceName).join(", ")}`);
    const line = parts.join(" — ");
    const where = pictures[l.id]?.trim();
    return where ? `${line}\n    where it stands: ${where}` : line;
  });
  const head = open.length
    ? ["WHAT IS BEING FOLLOWED", "The reader's research labs:", ...roster]
    : [
        "WHAT IS BEING FOLLOWED",
        "Nothing yet — the reader has no research lab open, so nothing is being watched for them",
        "and a briefing has nothing to be cut by. Ask them what they want kept watch on, read the",
        "profile below for what they already care about, and propose labs from it with propose_lab.",
      ];
  return [
    ...head,
    "",
    "A lab is a standing room with a charter: the field of view it watches, the questions it",
    "exists to answer, and the sources it claims. Call propose_lab when the reader says they",
    "want something followed that no lab above covers. You draft the charter out of the conversation",
    "and the profile and show it on a card; the reader corrects it by talking. Never ask them to",
    "fill anything in, and never say a lab exists until they have applied the card.",
    "A lab is permanent — it stays open until the reader says to close it, and archive_lab only",
    "ever proposes that when they ask for it.",
    "One lab is the widest range one baseline model covers. Three tests: the yardstick for",
    "'is this abnormal' is the same throughout (embodied AI and AI agents both read arXiv, but",
    "against different yardsticks, so they are two labs); the things it watches for explain each",
    "other; and its picture fits in one context. Where a test fails, propose two labs rather than",
    "one wide one.",
  ].join("\n");
}

/**
 * The propose_lab tool: draft a room out of what the reader just said. It writes
 * nothing — the card's Apply opens the room and claims its sources, in the host.
 */
export function buildProposeLabTool(deps: LabToolDeps): AgentTool {
  return {
    name: "propose_lab",
    description:
      "Propose a research lab: a standing room that watches one area for the user from now on. " +
      "Call it when they say what they want followed ('keep an eye on embodied AI', '我想盯住 " +
      "国债利率'), and when the conversation makes plain that something they care about has " +
      "nobody watching it. `name` is short and theirs, not a category. `scope` is one paragraph " +
      "drawing the field of view — what is inside it and what is deliberately outside. " +
      "`questions` are the questions the room exists to answer. `sources` names the subscribed " +
      "sources it claims, from the roster in your instructions (a source no lab claims is read " +
      "for all of them, so claim only what is really this room's). It files nothing — the user " +
      "sees a card and applies it. Do not tell them the lab exists until they have.",
    parameters: Type.Object({
      name: Type.String({ description: "Short name for the lab, in the user's own words." }),
      scope: Type.String({
        description:
          "One paragraph: what is inside this lab's field of view, and what is outside it.",
      }),
      questions: Type.Array(Type.String(), {
        description: "The questions this lab exists to answer.",
      }),
      sources: Type.Array(Type.String(), {
        description: "Subscribed sources this lab claims, named as the source roster spells them.",
      }),
    }),
    execute: async (args) => {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("propose_lab needs a name for the lab.");
      const scope = String(args.scope ?? "").trim();
      if (!scope) throw new Error("propose_lab needs a scope paragraph: what the lab watches.");
      const labs = await deps.labs();
      // A refusal, not a thrown error: the model did the reasonable thing and
      // just needs to see that the room is already open.
      const taken = labNameTaken(name, labs);
      if (taken) {
        return (
          `The user already has a lab called "${taken.name}" (id: ${taken.id}), so nothing was ` +
          `proposed. Talk about that one instead — widen its charter if this is really the same ` +
          `ground — or propose a differently named lab if it is not.`
        );
      }
      const questions = toStrings(args.questions);
      const { claimed, unknown } = resolveClaimedSources(toStrings(args.sources), await deps.sources());
      deps.onLabCard({
        kind: "lab-proposal",
        threadId: deps.threadId,
        name,
        scope,
        questions,
        sources: claimed.map((s) => s.id),
        sourceNames: claimed.map((s) => s.name),
        phase: "draft",
      });
      const dropped = unknown.length
        ? ` ${unknown.map((u) => `"${u}"`).join(", ")} ${unknown.length === 1 ? "is" : "are"} not ` +
          `in the user's source list, so ${unknown.length === 1 ? "it was" : "they were"} left ` +
          `out — say so if it matters, and do not claim the lab reads ` +
          `${unknown.length === 1 ? "it" : "them"}.`
        : "";
      return (
        `Proposed a lab called "${name}"${claimed.length ? `, claiming ${claimed.map((s) => s.name).join(", ")}` : ", claiming no sources yet"}. ` +
        `A card now shows the user the charter. Nothing is filed yet — they Apply it themselves, ` +
        `and they can have you change any of it first.${dropped}`
      );
    },
  };
}

/**
 * The archive_lab tool: propose closing a room the reader is done with. Like
 * propose_lab it only drafts; the card's Apply archives.
 */
export function buildArchiveLabTool(deps: LabToolDeps): AgentTool {
  return {
    name: "archive_lab",
    description:
      "Propose closing one of the user's research labs, when they say they are done with it " +
      "('stop following the macro stuff', '这个不用盯了'). Never on your own initiative: a quiet " +
      "lab is a lab with nothing to report, not a lab to close. `labId` is the id of a lab from " +
      "the roster in your instructions. Closing keeps the record and its picture — nothing is " +
      "deleted — and it can be reopened. It archives nothing itself: the user sees a card and " +
      "applies it.",
    parameters: Type.Object({
      labId: Type.String({ description: "The id of the lab to close, from your instructions." }),
    }),
    execute: async (args) => {
      const raw = String(args.labId ?? "").trim();
      if (!raw) throw new Error("archive_lab needs the id of the lab to close.");
      const labs = await deps.labs();
      const lab = resolveLab(raw, labs);
      if (!lab) {
        const open = activeLabs(labs);
        return (
          `"${raw}" is not one of the user's open labs, so nothing was proposed. ` +
          (open.length
            ? `The open ones:\n${open.map((l) => `- ${l.name} (id: ${l.id})`).join("\n")}\nAsk which they mean.`
            : `They have no open labs at all.`)
        );
      }
      deps.onLabCard({
        kind: "lab-archive",
        threadId: deps.threadId,
        labId: lab.id,
        name: lab.name,
        phase: "draft",
      });
      return (
        `Proposed closing the "${lab.name}" lab. A card now shows the user; nothing is closed ` +
        `until they apply it. Its picture and what it has filed are kept either way.`
      );
    },
  };
}

// Tool arguments arrive as whatever the model sent. An array of strings is what
// the schema asks for; anything else reads as nothing rather than as a string
// spelling of itself.
function toStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v ?? "").trim()).filter((v) => v !== "");
}
