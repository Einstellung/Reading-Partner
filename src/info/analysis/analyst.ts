// The analyst run (docs/63 加工): one room, one day. It reads the room's picture
// and the cables that hit it today, and hands back an increment against what is
// already known — not a report, and not a rewrite of the picture.
//
// The prompt carries the half of docs/63 质量规则 that only a prompt can enforce:
// the key-assumption check, competing hypotheses, "what would overturn this",
// "same as last time or changed, and why", and the standing ban on hedging to
// avoid being wrong. The other half is程序-checked — the enum words in
// applyDelta, the cover's strength in rules.ts.
//
// Everything here is pure. run.ts makes the calls.
//
// Deviation from docs/63 for this release: one analyst per lab, not one per
// concern. The room's questions stand in for the concerns until studies land.

import { aiLanguageName, type AiLanguage } from "../../platform/app/settings";
import type { ParseTally } from "../../platform/app/structured-output";
import { pictureSummary } from "../picture/picture";
import type { Confidence, Likelihood, Picture, PictureDelta } from "../picture/types";
import { asArray, asText, isObject, readObject } from "./json";
import type { AnalystCable, AnalystInput, AnalystOutput, ParseOutcome } from "./types";

// How much of each cable's body the analyst reads. The same cut triage used:
// enough to judge substance across a day's worth of items without the prompt
// growing with the day.
export const ANALYST_TEXT_CHARS = 1500;
// How much of the picture prints into the prompt. The picture is the room's
// whole memory and grows without bound; the summary is deliberately a summary —
// docs/63 says more cables make a judgment more certain, not more accurate, and
// the same is true of more history.
export const PICTURE_SUMMARY_CHARS = 3000;
// The cable summary line. Cables cap theirs at 400 already; this guards a body
// that arrived in the summary field.
export const CABLE_SUMMARY_CHARS = 400;

// The one line pinning the language of everything the analyst writes. The delta
// is prose the reader will eventually see through the cover and the picture
// page, so it follows the same setting as the rest of the app rather than
// drifting into the language of whatever source happened to publish today.
function analystLanguageLine(aiLanguage: AiLanguage): string {
  const name = aiLanguageName(aiLanguage);
  return name
    ? `Write every piece of text you produce in ${name}, even when the cables are in another language.`
    : "Write every piece of text you produce in English (the UI language), even when the cables are in another language.";
}

export function analystSystemPrompt(aiLanguage: AiLanguage = "auto"): string {
  return [
    "You are the analyst of one research room. The room follows a standing question",
    "for one reader. It keeps a picture: what normal looks like there (the baseline),",
    "what it is watching for (observables), what it has concluded so far (judgments),",
    "and what it still cannot answer (open questions).",
    "",
    "Today a handful of cables — items that got past screening — landed in this room.",
    "Your output is an INCREMENT against the picture: what changed, what was",
    "confirmed, what is now watched. You are not writing a report, a digest or a",
    "summary of the cables. Nobody reads your output as prose; a program applies it",
    "to the picture. If today's cables move nothing, say so with an empty increment —",
    "that is a real answer, not a failure.",
    "",
    "More cables do not make a judgment more accurate. They make it more certain.",
    "Volume raises `confidence`; only better evidence moves `likelihood`.",
    "",
    "HOW TO THINK",
    "",
    "1. Key-assumption check. Before you write a judgment, list the premises it rests",
    "   on and ask of each one: must this be true? Keep only the premises that must",
    "   be. A judgment that survives with fewer premises is the one to write.",
    "2. Competing hypotheses. Hold at least two explanations of what you are seeing.",
    "   Evidence that fits every explanation tells you nothing. Count the evidence",
    "   INCONSISTENT with each hypothesis, not the evidence consistent with it, and",
    "   let the hypothesis with the fewest inconsistencies stand.",
    "3. Every judgment names what would overturn it. Write that falsifier as an entry",
    "   in `observables.add`, phrased as something a future headline could hit — a",
    "   filing, a number, a departure, an announcement. A judgment with no falsifier",
    "   is an opinion; do not write it.",
    "4. Say whether each judgment is the same as last time or changed, and why. When",
    "   it updates one already in the picture, set `supersedes` to that judgment's id",
    "   and let `rationale` say what moved it. Do not repeat a judgment unchanged",
    "   just to have written something.",
    "5. Do not hedge to avoid being wrong. The room exists to reach judgments a",
    "   headline reader would not. Passing on a hard call because it is hard is the",
    "   failure mode here; passing on a trivial one is not.",
    "",
    "THE BASELINE",
    "",
    "The baseline is the room's model of normal — structure, cost constraints, the",
    "averages that decide what counts as abnormal. It is what makes a cable readable",
    "as a departure. Once written, do not rewrite it because a day was busy; rewrite",
    "it only when the evidence shows the old one was WRONG, and say so in `notes`.",
    "Omit the `baseline` field entirely when you are not changing it.",
    "",
    "OBSERVABLES",
    "",
    "`observables.hit` records which of the room's existing observables today's",
    "cables actually touched, each with the cable ids that touched it. Use the exact",
    "ids in brackets from the picture below; never invent one, never hit an",
    "observable the cables did not touch. `observables.retire` is for an observable",
    "that can no longer be hit — the question it watched is settled or the thing it",
    "watched is gone. Retire sparingly: an observable that simply has not fired is",
    "working as intended.",
    "",
    "EVIDENCE",
    "",
    "Every judgment lists the cable ids it rests on in `cables`. Cite only ids from",
    "today's cables or ids already in the picture. What is known about the reader is",
    "never evidence about the world; it decides what this room is for, not what is",
    "true in it.",
    "",
    "STRENGTH",
    "",
    "`likelihood` is exactly one of: almost-no-chance, very-unlikely, unlikely,",
    "roughly-even, likely, very-likely, almost-certain.",
    "`confidence` is exactly one of: low, moderate, high.",
    "Use those strings and nothing else. Never write a percentage or a probability",
    "figure anywhere in your text — not in a judgment, not in a rationale, not in a",
    "note. The words above are the whole vocabulary for how sure you are.",
    "",
    analystLanguageLine(aiLanguage),
    "",
    "Output STRICT JSON only, no markdown fence, no prose around it, matching:",
    "{",
    '  "delta": {',
    '    "baseline": string,                       // omit unless you are changing it',
    '    "observables": {',
    '      "add": [{ "text": string, "baseline": string }],',
    '      "hit": [{ "id": string, "cables": [string] }],',
    '      "retire": [string]',
    "    },",
    '    "judgments": [{',
    '      "text": string, "likelihood": string, "confidence": string,',
    '      "cables": [string], "supersedes": string, "rationale": string',
    "    }],",
    '    "openQuestions": { "add": [string], "answered": [string] }',
    "  },",
    '  "notes": string                             // your working note on the day',
    "}",
  ].join("\n");
}

// The cold-start block (docs/63 章程, 冷启动 step 2). A room whose picture is
// still empty has nothing to write an increment against, so this one run asks
// for the two things every later run assumes: what normal looks like here, and
// the first things to watch. It is asked from the cables actually read, never
// from the model's general knowledge — that is the whole point of ordering the
// recruiter before the analyst.
function coldStartBlock(): string {
  return [
    "COLD START — this room has no baseline and nothing under watch yet.",
    "Before anything else, do two things from the cables below and only from them:",
    "1. Draft the `baseline`: how this field normally works — its structure, who the",
    "   actors are, what the cost and capacity constraints are, the ordinary ranges",
    "   and rhythms. It has to be specific enough that a future cable can be read as",
    "   normal or as a departure. Say plainly what you could not establish from",
    "   today's cables rather than filling it in from general knowledge.",
    "2. Write the first `observables.add` — the things that, if they moved, would",
    "   answer the room's questions. Ground each one in something the cables showed",
    "   you exists and is reported on.",
    "Judgments are optional on a cold start. A room that has read one day of cables",
    "is allowed to have concluded nothing yet.",
  ].join("\n");
}

/** A room that has read nothing: no baseline, nothing under watch. */
export function isColdStart(picture: Picture): boolean {
  return picture.baseline.trim() === "" && picture.observables.length === 0;
}

function formatCharter(input: AnalystInput): string {
  const { lab } = input;
  const questions =
    lab.charter.questions.length > 0
      ? lab.charter.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")
      : "(none written yet)";
  return [
    `ROOM: ${lab.name}`,
    "SCOPE (where this room's field of view ends)",
    lab.charter.scope.trim() || "(no scope written yet)",
    "",
    "QUESTIONS THIS ROOM EXISTS TO ANSWER",
    questions,
  ].join("\n");
}

function formatCable(cable: AnalystCable, textChars: number): string {
  const body = (cable.text || "").slice(0, textChars).trim();
  const summary = (cable.summary || "").slice(0, CABLE_SUMMARY_CHARS).trim();
  const published = cable.publishedAt ? ` | ${cable.publishedAt}` : "";
  // Which of this room's observables the screen said it hit, so the analyst can
  // see what it was kept for. An empty list is a scope-level hit.
  const hit = cable.hits
    .flatMap((h) => h.observables)
    .filter((id, i, all) => all.indexOf(id) === i);
  return [
    `id: ${cable.id} | ${cable.sourceName || cable.source}${published}`,
    `title: ${cable.title}`,
    `screened as hitting: ${hit.length > 0 ? hit.join(", ") : "(the room's scope, no observable named)"}`,
    summary ? `summary: ${summary}` : "summary: (none)",
    body ? `text: ${body}` : "text: (no body retrieved)",
  ].join("\n");
}

export interface AnalystMessageOptions {
  textChars?: number;
  summaryChars?: number;
}

export function analystUserMessage(
  input: AnalystInput,
  opts: AnalystMessageOptions = {},
): string {
  const textChars = opts.textChars ?? ANALYST_TEXT_CHARS;
  const summary = pictureSummary(input.picture, {
    maxChars: opts.summaryChars ?? PICTURE_SUMMARY_CHARS,
  });
  const profile = input.memory.profile.trim();
  const observations = input.memory.observations.trim();
  return [
    formatCharter(input),
    "",
    "THE PICTURE AS IT STANDS",
    summary.trim() || "(empty — this room has read nothing yet)",
    "",
    // Labelled hard, because a model handed a paragraph about a person will
    // otherwise reason about the world from it (docs/63: concern 只说用户,
    // 可观测项只说世界).
    "ABOUT THE READER (this is about the person, NOT about the world — it says who",
    "this room is for and what they already know. It is never evidence.)",
    profile || "(no profile set)",
    ...(observations ? ["", "Recent observations:", observations] : []),
    "",
    ...(isColdStart(input.picture) ? [coldStartBlock(), ""] : []),
    `TODAY'S CABLES (${input.cables.length}, ${input.date})`,
    input.cables.length > 0
      ? input.cables.map((c) => formatCable(c, textChars)).join("\n\n")
      : "(none)",
    "",
    "Return the increment JSON now.",
  ].join("\n");
}

// --- validation -----------------------------------------------------------

// Read the delta the model wrote. Shape only: an entry that is not an object,
// or has no text where text is required, is dropped here; an id naming nothing
// and a likelihood word off the ladder are NOT — they go through to applyDelta,
// which knows the picture and turns each into one warning. That split is what
// keeps a bad reply costing a warning instead of a picture, and it is why the
// casts below are safe: applyDelta re-reads every field from `unknown`.
export function parseAnalystOutput(
  raw: string,
  picture: Picture,
  tally?: ParseTally,
): ParseOutcome<AnalystOutput> {
  const read = readObject(raw);
  if (!read.ok) return read;
  const body = read.value;

  const deltaRaw = body.delta;
  if (!isObject(deltaRaw)) {
    if (tally) tally.fail = "missing-field";
    return { ok: false, error: "missing delta object" };
  }

  const obsRaw = isObject(deltaRaw.observables) ? deltaRaw.observables : {};
  const questionsRaw = isObject(deltaRaw.openQuestions) ? deltaRaw.openQuestions : {};

  const add: PictureDelta["observables"]["add"] = [];
  for (const entry of asArray(obsRaw.add)) {
    if (tally) tally.seen++;
    if (!isObject(entry)) continue;
    const text = asText(entry.text);
    if (text === "") continue;
    const baseline = asText(entry.baseline);
    add.push(baseline === "" ? { text } : { text, baseline });
    if (tally) tally.kept++;
  }

  const hit: PictureDelta["observables"]["hit"] = [];
  for (const entry of asArray(obsRaw.hit)) {
    if (tally) tally.seen++;
    if (!isObject(entry)) continue;
    const id = asText(entry.id);
    if (id === "") continue;
    hit.push({
      id,
      cables: asArray(entry.cables)
        .map(asText)
        .filter((c) => c !== ""),
    });
    if (tally) tally.kept++;
  }

  const retire = asArray(obsRaw.retire)
    .map(asText)
    .filter((id) => id !== "");

  const judgments: PictureDelta["judgments"] = [];
  for (const entry of asArray(deltaRaw.judgments)) {
    if (tally) tally.seen++;
    if (!isObject(entry)) continue;
    const text = asText(entry.text);
    if (text === "") continue;
    const j: PictureDelta["judgments"][number] = {
      text,
      // Not checked against the ladder here on purpose: applyDelta drops an
      // unknown word with a warning that names the judgment, and a warning the
      // reader can see beats a silent repair.
      likelihood: asText(entry.likelihood) as Likelihood,
      confidence: asText(entry.confidence) as Confidence,
      cables: asArray(entry.cables)
        .map(asText)
        .filter((c) => c !== ""),
    };
    const supersedes = asText(entry.supersedes);
    if (supersedes !== "") j.supersedes = supersedes;
    const rationale = asText(entry.rationale);
    if (rationale !== "") j.rationale = rationale;
    judgments.push(j);
    if (tally) tally.kept++;
  }

  const delta: PictureDelta = {
    observables: { add, hit, retire },
    judgments,
    openQuestions: {
      add: asArray(questionsRaw.add)
        .map(asText)
        .filter((q) => q !== ""),
      answered: asArray(questionsRaw.answered)
        .map(asText)
        .filter((q) => q !== ""),
    },
  };
  const baseline = asText(deltaRaw.baseline);
  // An empty baseline field is "no change", never an erasure — the room's model
  // of normal is too expensive to lose to a model that left a key blank. On a
  // cold start there is nothing to erase anyway.
  if (baseline !== "" && baseline !== picture.baseline) delta.baseline = baseline;

  return { ok: true, output: { delta, notes: asText(body.notes) } };
}
