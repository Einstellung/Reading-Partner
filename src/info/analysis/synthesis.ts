// The synthesis run (docs/63 加工, 呈现): the room's second call of the day. The
// analyst has already moved the picture; this one reads the picture before and
// after and writes the one thing the reader actually sees — the cover: what
// changed in this room today.
//
// It also picks the day's reading out of the room's own cables. The reason it
// gives is not "this is interesting": it names which judgment or which
// observable the article moved. A room that cannot say that has nothing to
// recommend.
//
// Pure. run.ts makes the call.

import { aiLanguageName, type AiLanguage } from "../../platform/app/settings";
import type { ParseTally } from "../../platform/app/structured-output";
import type { Cable } from "../cable/types";
import { pictureSummary } from "../picture/picture";
import type { Judgment, Picture } from "../picture/types";
import { asArray, asText, isObject, readObject } from "./json";
import { PICTURE_SUMMARY_CHARS } from "./analyst";
import type { ParseOutcome, SynthesisInput, SynthesisOutput } from "./types";

// The reader's day, not the room's. Three articles is already a lot to ask of
// someone who has several rooms.
export const MAX_MUST_READ = 3;
export const MAX_ONE_LINERS = 8;
const CABLE_SUMMARY_CHARS = 400;

function synthesisLanguageLine(aiLanguage: AiLanguage): string {
  const name = aiLanguageName(aiLanguage);
  return name
    ? `Write the cover, the reasons and the one-liners in ${name}, even when the cables are in another language.`
    : "Write the cover, the reasons and the one-liners in English (the UI language), even when the cables are in another language.";
}

export function synthesisSystemPrompt(aiLanguage: AiLanguage = "auto"): string {
  return [
    "You write the cover of one research room's box for today. The room's analyst has",
    "already read the day and moved the room's picture; you are shown the picture",
    "before and after, exactly what moved, and the cables it moved on.",
    "",
    "THE COVER",
    "",
    "One to three sentences answering one question: what changed in this domain",
    "today, for this reader. Not a list of headlines, not a summary of the articles,",
    "not a description of the room's process. Every change you name must be",
    "traceable to a cable below — if you cannot point at the cable, do not write the",
    "sentence.",
    "",
    "Say it plainly and in the reader's own terms. Do not write about the picture,",
    "the observables, the judgments or the analyst; write about the world. Never",
    "mention ids in the cover.",
    "",
    "NOTHING HAPPENED IS AN ANSWER",
    "",
    'Set `changed` to false, with `cover` as an empty string, when the day added no',
    "judgment, added no observable, and hit nothing that was not already being hit.",
    "The reader is then simply told this room was quiet, which is worth more than a",
    "sentence manufactured to fill the space. Do not stretch a routine day into a",
    "change.",
    "",
    "STRENGTH",
    "",
    "The cover may not claim more than the judgments behind it. If the strongest",
    "judgment added today is `likely`, the cover may not say something is almost",
    "certain or inevitable. If today added no judgment at all, the cover states what",
    "happened and claims nothing about what it means. Never write a percentage or a",
    "probability figure.",
    "",
    "WHAT TO READ",
    "",
    `\`mustRead\`: at most ${MAX_MUST_READ} cables, often none. The \`reason\` says what this article`,
    "did to the room's picture — which judgment it supports or undercuts, which",
    "observable it hit — in one sentence written to the reader. A reason that would",
    "fit any article ('a detailed look at the topic') is not a reason.",
    `\`oneLiners\`: at most ${MAX_ONE_LINERS} cables worth knowing but not worth opening. The \`line\``,
    "IS the reading: what happened, who, the number that matters. Not a teaser.",
    "A cable appears in at most one of the two lists. Reference cables only by the",
    "exact `id` given below.",
    "",
    synthesisLanguageLine(aiLanguage),
    "",
    "Output STRICT JSON only, no markdown fence, no prose around it, matching:",
    "{",
    '  "changed": boolean,',
    '  "cover": string,',
    '  "mustRead": [{ "itemId": string, "reason": string }],',
    '  "oneLiners": [{ "itemId": string, "line": string }]',
    "}",
  ].join("\n");
}

// What today actually did to the picture, computed by the program from the two
// pictures rather than taken from the analyst's word for it. The synthesis is
// told the truth about the day even when the analyst's notes overstate it.
export function judgmentsAddedToday(before: Picture, after: Picture): Judgment[] {
  const known = new Set(before.judgments.map((j) => j.id));
  return after.judgments.filter((j) => !known.has(j.id));
}

function formatDelta(input: SynthesisInput): string {
  const added = judgmentsAddedToday(input.before, input.after);
  const knownObservables = new Set(input.before.observables.map((o) => o.id));
  const newObservables = input.after.observables.filter((o) => !knownObservables.has(o.id));
  const hits = input.delta.observables.hit
    .map((h) => {
      const o = input.after.observables.find((x) => x.id === h.id);
      return o ? `- [${o.id}] ${o.text} — hit by ${h.cables.join(", ") || "(no cable named)"}` : null;
    })
    .filter((line): line is string => line !== null);
  const baselineChanged = input.before.baseline !== input.after.baseline;

  const blocks: string[] = [];
  blocks.push(
    added.length > 0
      ? [
          "JUDGMENTS ADDED TODAY",
          ...added.map(
            (j) =>
              `- [${j.id}] ${j.text} — ${j.likelihood}, ${j.confidence} confidence${
                j.supersedes ? `, updates ${j.supersedes}` : ""
              }${j.rationale ? `\n  because: ${j.rationale}` : ""}`,
          ),
        ].join("\n")
      : "JUDGMENTS ADDED TODAY\n(none)",
  );
  blocks.push(
    newObservables.length > 0
      ? ["NOW BEING WATCHED (new today)", ...newObservables.map((o) => `- ${o.text}`)].join("\n")
      : "NOW BEING WATCHED (new today)\n(none)",
  );
  blocks.push(
    hits.length > 0 ? ["OBSERVABLES HIT TODAY", ...hits].join("\n") : "OBSERVABLES HIT TODAY\n(none)",
  );
  if (baselineChanged) {
    blocks.push("THE ROOM'S MODEL OF NORMAL WAS REWRITTEN TODAY.");
  }
  return blocks.join("\n\n");
}

function formatCable(cable: Cable): string {
  const published = cable.publishedAt ? ` | ${cable.publishedAt}` : "";
  const summary = (cable.summary || "").slice(0, CABLE_SUMMARY_CHARS).trim();
  return [
    `id: ${cable.id} | ${cable.sourceName || cable.source}${published}`,
    `title: ${cable.title}`,
    summary ? `summary: ${summary}` : "summary: (none)",
  ].join("\n");
}

export function synthesisUserMessage(input: SynthesisInput): string {
  const { lab } = input;
  const questions =
    lab.charter.questions.length > 0
      ? lab.charter.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")
      : "(none written yet)";
  return [
    `ROOM: ${lab.name}`,
    "SCOPE",
    lab.charter.scope.trim() || "(no scope written yet)",
    "",
    "QUESTIONS THIS ROOM EXISTS TO ANSWER",
    questions,
    "",
    "THE PICTURE BEFORE TODAY",
    pictureSummary(input.before, { maxChars: PICTURE_SUMMARY_CHARS }).trim() ||
      "(empty — this room had read nothing before today)",
    "",
    "WHAT TODAY MOVED",
    formatDelta(input),
    "",
    "THE PICTURE AFTER TODAY",
    pictureSummary(input.after, { maxChars: PICTURE_SUMMARY_CHARS }).trim() || "(still empty)",
    "",
    `TODAY'S CABLES (${input.cables.length}, ${input.date})`,
    input.cables.length > 0 ? input.cables.map(formatCable).join("\n\n") : "(none)",
    "",
    "Return the cover JSON now.",
  ].join("\n");
}

// --- validation -----------------------------------------------------------

interface Ref {
  itemId: string;
  text: string;
}

function readRefs(raw: unknown, field: string, validIds: Set<string>, tally?: ParseTally): Ref[] {
  const out: Ref[] = [];
  const seen = new Set<string>();
  for (const entry of asArray(raw)) {
    if (tally) tally.seen++;
    if (!isObject(entry)) continue;
    const itemId = asText(entry.itemId);
    const text = asText(entry[field]);
    // An id nobody sent it is an invented cable: dropped, never rendered.
    if (itemId === "" || text === "" || !validIds.has(itemId) || seen.has(itemId)) continue;
    out.push({ itemId, text });
    seen.add(itemId);
    if (tally) tally.kept++;
  }
  return out;
}

/**
 * Read the cover the model wrote. Unknown cable ids are dropped, the caps are
 * applied here rather than trusted to the prompt, and a cable that made both
 * lists is kept only in mustRead — the reader must never see the same article
 * twice under one room.
 */
export function parseSynthesisOutput(
  raw: string,
  cables: Cable[],
  tally?: ParseTally,
): ParseOutcome<SynthesisOutput> {
  const read = readObject(raw);
  if (!read.ok) return read;
  const body = read.value;

  if (typeof body.changed !== "boolean") {
    if (tally) tally.fail = "missing-field";
    return { ok: false, error: "missing or non-boolean changed" };
  }
  const cover = asText(body.cover);
  if (body.changed && cover === "") {
    if (tally) tally.fail = "missing-field";
    return { ok: false, error: "changed with an empty cover" };
  }

  const validIds = new Set(cables.map((c) => c.id));
  const mustRead = readRefs(body.mustRead, "reason", validIds, tally).slice(0, MAX_MUST_READ);
  const taken = new Set(mustRead.map((r) => r.itemId));
  const oneLiners = readRefs(body.oneLiners, "line", validIds, tally)
    .filter((r) => !taken.has(r.itemId))
    .slice(0, MAX_ONE_LINERS);

  return {
    ok: true,
    output: {
      changed: body.changed,
      // A cover on a day that changed nothing is not shown, so it is not kept.
      cover: body.changed ? cover : "",
      mustRead: mustRead.map((r) => ({ itemId: r.itemId, reason: r.text })),
      oneLiners: oneLiners.map((r) => ({ itemId: r.itemId, line: r.text })),
    },
  };
}
