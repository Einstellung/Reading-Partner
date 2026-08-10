// The AI's own guesses about the reader: the half of the profile nobody dictated.
//
// The profile has one writer today — the reader applies an update_profile card in
// chat — so it only ever says what the reader has said out loud, and it goes
// stale between those moments. This pass adds the other half: a silent sub-agent
// that reads the topics' observations and the info side's attention log and
// writes down what it now thinks this reader is after.
//
// A guess is a mentalization, not a reading log. "Read a book on macro trends" is
// re-derivable from disk and belongs nowhere; "picks investment books about the
// era rather than the method, and marks capital-flow passages, so what he wants
// is a read on the period, not stock-picking technique" is the thing that cannot
// be re-derived and is worth 40 characters of every prompt.
//
// The safety property this file exists for: an automatic write may replace the
// guess section and NOTHING else. The model never rewrites the document — it
// returns entries through one tool, and the code below renders them and splices
// them between the two markers. The declared half comes back byte for byte
// because it is never handed to a text generator in the first place. When the
// markers do not parse, the whole file is treated as declared and the pass gives
// up rather than guessing where the boundary was.
//
// Pure: no filesystem, no provider. live.ts binds the store, the model and the
// event log.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../ai/agent";
import {
  runSubagent,
  type SubagentDefinition,
  type SubagentModel,
  type SubagentOutcome,
  type SubagentTurnFn,
} from "../ai/subagent";
import type { FeedbackEvent } from "./feedback";
import type { ObservationIndexEntry } from "./types";

// --- the section markers ---

// HTML comments: invisible wherever the profile is rendered as markdown, and
// nothing a model writing prose would produce by accident. They are matched
// literally and must each appear exactly once, in order — anything else is an
// unparseable file (see splitProfile).
export const GUESS_BEGIN = "<!-- ai-guess:begin -->";
export const GUESS_END = "<!-- ai-guess:end -->";
export const GUESS_HEADING = "## What the AI guesses about you (its own inferences — unverified)";

// --- sizes (docs/28: the profile is resident context, so it is a budget) ---

// Entries the guess section may hold. A ninth guess is not a ninth thing known
// about the reader, it is the first one that was never worth writing down.
export const MAX_GUESSES = 8;
// Characters the rendered guess section may occupy, markers and heading aside.
export const GUESS_SECTION_CHARS = 600;
// Characters the whole profile aims to stay under. Only guesses are ever cut for
// it: the declared half is the reader's own document.
export const PROFILE_CHARS = 1500;
// Per-entry clips, so one runaway sentence cannot eat the whole section.
export const GUESS_TEXT_CHARS = 150;
export const GUESS_BASIS_CHARS = 120;

// --- the entry ---

export interface ProfileGuess {
  // The guess itself, one sentence.
  text: string;
  // What it is drawn from, one sentence: which book, which behaviour, when.
  // An entry without this is dropped by normalizeGuesses — a guess with no
  // stated basis cannot be argued with later, by the reader or by the next pass.
  basis: string;
  // When this guess was first written, YYYY-MM-DD. Carried across passes so a
  // long-standing guess reads as long-standing.
  since: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// One entry as the file stores it, and as the prompts read it back. The two
// separators are reserved: normalize() strips them out of the fields, so the
// round trip is exact for anything that gets written.
const ENTRY_LINE = /^-\s+(.+?)\s+\|\s*basis:\s*(.+?)\s+\|\s*since:\s*(\d{4}-\d{2}-\d{2})\s*$/;

export function renderGuessLine(g: ProfileGuess): string {
  return `- ${g.text} | basis: ${g.basis} | since: ${g.since}`;
}

export function parseGuessLine(line: string): ProfileGuess | null {
  const m = ENTRY_LINE.exec(line.trim());
  if (!m) return null;
  return { text: m[1].trim(), basis: m[2].trim(), since: m[3] };
}

// Collapse whitespace and remove the two reserved separators, so a field can
// never break the line format it is about to be written into.
function field(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").replace(/\|/g, "/").trim();
  return t.length <= max ? t : t.slice(0, max).trimEnd() + "…";
}

// --- splitting the document ---

export interface ProfileSplit {
  // False when the markers are missing one half, doubled, or out of order. The
  // caller must not write: `before` then holds the entire file and the boundary
  // is unknown, so any splice would eat the reader's own words.
  ok: boolean;
  // Everything ahead of the guess section, byte for byte. The whole file when
  // there is no section (which is what every profile written before this pass
  // existed looks like — that is the entire migration).
  before: string;
  // Everything after it, byte for byte. Normally "".
  after: string;
  guesses: ProfileGuess[];
}

export function splitProfile(text: string): ProfileSplit {
  const begin = text.indexOf(GUESS_BEGIN);
  const end = text.indexOf(GUESS_END);
  if (begin === -1 && end === -1) return { ok: true, before: text, after: "", guesses: [] };
  const bad =
    begin === -1 ||
    end === -1 ||
    end < begin ||
    text.lastIndexOf(GUESS_BEGIN) !== begin ||
    text.lastIndexOf(GUESS_END) !== end;
  if (bad) return { ok: false, before: text, after: "", guesses: [] };
  const body = text.slice(begin + GUESS_BEGIN.length, end);
  const guesses: ProfileGuess[] = [];
  for (const line of body.split("\n")) {
    const g = parseGuessLine(line);
    // A line that is not an entry (the heading, a blank) is skipped; a mangled
    // entry is dropped, and the next pass gets the chance to write it again.
    if (g) guesses.push(g);
  }
  return { ok: true, before: text.slice(0, begin), after: text.slice(end + GUESS_END.length), guesses };
}

// The declared half as one string — what the reader themselves put in the
// profile. On an unparseable file this is the whole document, which is the safe
// reading: everything is treated as the reader's, and nothing is overwritten.
export function declaredText(split: ProfileSplit): string {
  return split.after ? split.before + split.after : split.before;
}

// The section as it sits in the file, markers included and no trailing newline
// of its own (that belongs to whatever follows). "" when there is nothing to
// guess, so a profile with no guesses carries no markers either.
export function renderGuessSection(guesses: ProfileGuess[]): string {
  if (guesses.length === 0) return "";
  return [GUESS_BEGIN, GUESS_HEADING, ...guesses.map(renderGuessLine), GUESS_END].join("\n");
}

// The document with its guess section replaced. `before` and `after` are pasted
// back untouched — the only bytes that can appear outside the section are the
// blank line separating the declared half from it and the file's final newline,
// each added at most once: by the next parse both belong to `before`/`after`, so
// composing again changes nothing. (Tested: composing twice is a fixed point.)
export function composeProfile(split: ProfileSplit, guesses: ProfileGuess[]): string {
  const section = renderGuessSection(guesses);
  const before = split.before;
  const sep =
    !section || before === "" ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const after = section && split.after === "" ? "\n" : split.after;
  return before + sep + section + after;
}

// The other direction: a new declared half, written by the user applying an
// update_profile card, with the guess section left standing. The card's model
// only ever sees the declared half (info/companion/chat.ts), so without this the
// Apply would drop the guesses on the floor — and a card that had been shown the
// guesses would instead promote them into the declared half, where nothing can
// ever revise them again.
export function replaceDeclared(current: string, declared: string): string {
  const split = splitProfile(current);
  // Boundary unknown: the user's own text replaces the file outright, which is
  // what a save with no guess section to preserve does anyway.
  if (!split.ok) return declared;
  return composeProfile({ ok: true, before: declared, after: "", guesses: split.guesses }, split.guesses);
}

// --- validating what the model returned ---

// One entry as the tool receives it, before any of the rules below have run.
export interface RawGuess {
  guess: string;
  basis: string;
  since?: string;
}

export interface NormalizeOptions {
  today: string; // YYYY-MM-DD
  // The set already on file, so an unchanged guess keeps the date it first
  // appeared instead of being restamped every pass.
  previous?: ProfileGuess[];
  // Characters the declared half occupies, so the section can be cut to keep the
  // whole document inside PROFILE_CHARS.
  declaredChars?: number;
}

// The rules, in code rather than in the prompt: an entry with no guess or no
// basis is dropped, fields are clipped, duplicates collapse, the set is capped,
// and the tail is cut until the rendered section fits its budget. A prompt can
// ask for all of this and will be followed most of the time; "most of the time"
// is not a size discipline.
export function normalizeGuesses(raw: RawGuess[], opts: NormalizeOptions): ProfileGuess[] {
  const sinceOf = new Map<string, string>();
  for (const p of opts.previous ?? []) sinceOf.set(p.text.toLowerCase(), p.since);

  const out: ProfileGuess[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const text = field(String(r?.guess ?? ""), GUESS_TEXT_CHARS);
    const basis = field(String(r?.basis ?? ""), GUESS_BASIS_CHARS);
    // No basis, no entry. The one rule that cannot live in the prompt: an
    // unfalsifiable guess is exactly what a model produces when it has nothing.
    if (!text || !basis) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const claimed = typeof r?.since === "string" && ISO_DATE.test(r.since.trim()) ? r.since.trim() : "";
    // An unchanged guess keeps its own first-seen date; otherwise the model's,
    // if it gave a real one that is not in the future; otherwise today.
    const since = sinceOf.get(key) ?? (claimed && claimed <= opts.today ? claimed : opts.today);
    out.push({ text, basis, since });
    if (out.length >= MAX_GUESSES) break;
  }

  // Budget last, so the cut falls on the entries the model ranked lowest.
  const room = Math.min(GUESS_SECTION_CHARS, PROFILE_CHARS - (opts.declaredChars ?? 0));
  while (out.length > 0 && out.map(renderGuessLine).join("\n").length > room) out.pop();
  return out;
}

// --- when the pass is allowed to run ---

// The bookkeeping the sweep keeps for this pass, on disk beside the profile.
export interface GuessState {
  lastRunAt: number | null;
  // The newest distillation stamp the last run saw. Memory that has not moved
  // past this cannot produce a different guess, so there is nothing to run for.
  lastMemoryAt: number | null;
}

// How long the pass rests between runs. Hours rather than the sweep's half hour:
// this is an identity document, and a reader's identity does not move at the
// speed of their highlighter. It rides the arrears sweep's tick (live.ts) but
// gates itself, so the two never share a cadence by accident.
export const GUESS_MIN_GAP_MS = 6 * 60 * 60_000;

// Time since the last run, and memory that has actually changed since it. Both,
// not either: a reader who marks up a book all afternoon moves the memory stamp
// every half hour, and a pass per half hour is the failure this gate prevents.
export function isGuessDue(
  state: GuessState,
  newestMemoryAt: number | null,
  now: number,
): boolean {
  // Nothing has ever been distilled, so there is no evidence to guess from.
  if (newestMemoryAt === null) return false;
  if (state.lastRunAt === null) return true;
  if (now - state.lastRunAt < GUESS_MIN_GAP_MS) return false;
  return state.lastMemoryAt === null || newestMemoryAt > state.lastMemoryAt;
}

// --- the evidence ---

export interface GuessTopicEvidence {
  topicName: string;
  entries: ObservationIndexEntry[];
}

// Observation lines per topic, and feedback events, the pass is shown. Caps, not
// budgets: this run is silent and nobody is waiting on it, but a reader with a
// year of topics would otherwise send the whole memory every six hours.
export const GUESS_TOPIC_LINES = 12;
export const GUESS_FEEDBACK_TAIL = 30;

export function formatTopicEvidence(topics: GuessTopicEvidence[]): string {
  const blocks: string[] = [];
  for (const topic of topics) {
    const lines = [...topic.entries]
      .sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id))
      .slice(0, GUESS_TOPIC_LINES)
      .map((e) => `- [${e.type}] ${e.summary} (updated ${e.updated})`);
    if (lines.length === 0) continue;
    blocks.push([`Topic "${topic.topicName.trim() || "Untitled"}":`, ...lines].join("\n"));
  }
  return blocks.join("\n\n");
}

// The info side's only attention signal: what the reader opened and what they
// threw away. Titles, oldest first.
export function formatAttentionTail(events: FeedbackEvent[], max = GUESS_FEEDBACK_TAIL): string {
  const tail = events.slice(-max);
  return tail
    .map((e) => `- ${e.action}: "${e.title}"${e.category ? ` [${e.category}]` : ""}`)
    .join("\n");
}

// --- the sub-agent ---

export const GUESS_AGENT_NAME = "profile_guesser";
// Read the evidence, call the tool once, finish. Nothing here is a lookup, so
// there is no searching to spend turns on.
export const GUESS_MAX_ROUNDS = 4;
export const GUESS_BRIEF_TOKENS = 200;
export const GUESS_TOOL_NAME = "profile_guess_set";

export interface ProfileGuessInput {
  // The reader's own half of the profile, shown as context the pass may not edit.
  declared: string;
  // The guess set as it stands. The model is asked for the next whole set, not a
  // delta.
  guesses: ProfileGuess[];
  topics: GuessTopicEvidence[];
  feedback: FeedbackEvent[];
  today: string; // YYYY-MM-DD
}

export function buildGuessSystemPrompt(input: ProfileGuessInput): string {
  return [
    "You keep a reading companion's guesses about who its reader is. Not a log of",
    "what they read — that is on disk already — but what you now think they are",
    "after, inferred from how they read it.",
    "This is a silent background pass: the reader sees nothing. Read the evidence,",
    `call ${GUESS_TOOL_NAME} once, then finish with the single word "done".`,
    "",
    "What a guess is:",
    "- Not \"read a book on macro trends\". That can be re-derived from the files.",
    "- \"Picks investment books about the era rather than the method, and marks",
    "  capital-flow and industrial-shift passages, so what he wants is a read on",
    "  the period rather than stock-picking technique.\" That cannot.",
    "- One sentence of guess, one sentence of basis naming the book, the behaviour",
    "  and roughly when. An entry whose basis you cannot state is discarded before",
    "  it reaches the file — do not send one.",
    "",
    "You are given the guesses you made before. Return the NEW WHOLE SET, not a",
    "delta: whatever you send replaces the section entirely.",
    "- Confirm the ones the new evidence supports again, and say so in the basis.",
    "- Narrow one that was vague now that you know more.",
    "- Merge two that turned out to be the same thing.",
    "- DROP the ones the evidence no longer supports, and drop the ones it",
    "  contradicts. This is the point of rewriting the whole set. A set that only",
    "  ever grows is how this section rots: it fills with the first impressions of",
    "  a reader who has since moved on, and every prompt in the app pays for them.",
    `- At most ${MAX_GUESSES} entries, and the whole section under about ${GUESS_SECTION_CHARS}`,
    "  characters. Order them by how much they would change what you say to this",
    "  reader: the tail is what gets cut.",
    "",
    "Guess what they are after and how they read. Do NOT guess how good they are:",
    "a verdict on their level, inferred from what they happened to highlight, comes",
    "back to them as a reason to be talked down to, and marking a passage is",
    "attention, not comprehension.",
    "",
    "The reader's own words are shown below as DECLARED. You cannot edit that half",
    "and you must not restate it: repeating back what they told you is not a guess",
    "and wastes the budget. Where your inference disagrees with something they",
    "stated, the disagreement itself may be the guess — say what changed and when.",
    "",
    "Attention signals (what they opened, what they dismissed) are evidence about",
    "intent, not a list of likes. \"Opened three pieces on X\" is not a guess; what",
    "they were checking for when they opened them might be. Whether an individual",
    "item was to their taste is another mechanism's job, not yours.",
    `Write absolute dates (today is ${input.today}); never "recently".`,
    "",
    "Guessing nothing new is a fine outcome — but if you call the tool at all, send",
    "the whole set you want kept, because the section is replaced by what you send.",
  ].join("\n");
}

export function buildGuessUserMessage(input: ProfileGuessInput): string {
  const lines = [`Date: ${input.today}`, "", "DECLARED (the reader's own words; you cannot edit this):"];
  lines.push(input.declared.trim() || "(empty)");
  lines.push("", "YOUR CURRENT GUESSES (the set you are rewriting):");
  lines.push(
    input.guesses.length ? input.guesses.map(renderGuessLine).join("\n") : "(none yet)",
  );
  lines.push("", "WHAT THEY HAVE BEEN READING (observations distilled per topic):");
  lines.push(formatTopicEvidence(input.topics) || "(nothing observed yet)");
  lines.push("", "WHAT THEY OPENED AND DISMISSED IN THEIR BRIEFING (oldest first):");
  lines.push(formatAttentionTail(input.feedback) || "(no reactions logged yet)");
  lines.push("", `Send the whole new set with ${GUESS_TOOL_NAME} now.`);
  return lines.join("\n");
}

// The one tool this run has. It writes nothing: it hands the entries back to the
// pass, which validates them and does the splice itself. A tool that wrote the
// file would put the file's shape inside the model's reach again.
export function buildGuessTool(capture: (raw: RawGuess[]) => void): AgentTool {
  return {
    name: GUESS_TOOL_NAME,
    description:
      "Replace your whole set of guesses about this reader. Send every guess you " +
      "want kept, including the ones you are keeping unchanged: what you send " +
      "becomes the section, and anything you leave out is dropped. Each entry " +
      "needs a basis; entries without one are discarded.",
    parameters: Type.Object({
      guesses: Type.Array(
        Type.Object({
          guess: Type.String({ description: "The guess, one sentence." }),
          basis: Type.String({
            description: "What it is drawn from: which book, which behaviour, roughly when.",
          }),
          since: Type.Optional(
            Type.String({
              description:
                "YYYY-MM-DD this guess was first made. Keep the existing date for a " +
                "guess you are carrying over; omit it for a new one.",
            }),
          ),
        }),
      ),
    }),
    execute: async (args) => {
      const raw = args.guesses;
      if (!Array.isArray(raw)) throw new Error("guesses must be an array");
      const entries: RawGuess[] = [];
      for (const el of raw) {
        if (!el || typeof el !== "object") continue;
        const o = el as Record<string, unknown>;
        entries.push({
          guess: typeof o.guess === "string" ? o.guess : "",
          basis: typeof o.basis === "string" ? o.basis : "",
          since: typeof o.since === "string" ? o.since : undefined,
        });
      }
      capture(entries);
      return `Recorded ${entries.length} guess(es).`;
    },
  };
}

export function buildGuessAgent(
  input: ProfileGuessInput,
  tools: AgentTool[],
  model?: SubagentModel,
): SubagentDefinition {
  return {
    name: GUESS_AGENT_NAME,
    // Never mounted as a tool: no model decides to re-guess the reader, the
    // sweep does.
    description: "Rewrite the AI's guesses about this reader.",
    label: "Updating the profile",
    systemPrompt: buildGuessSystemPrompt(input),
    tools,
    maxRounds: GUESS_MAX_ROUNDS,
    model,
    // Same reason as the distillers: a pass that concludes the current set still
    // holds makes no tool call, and "required" would file every one of those as a
    // failure and hold the stamp back.
    evidence: "optional",
    briefTokenCap: GUESS_BRIEF_TOKENS,
  };
}

// --- the pass ---

// What the pass reads and writes. Injected so the whole thing runs against a
// string in tests, with no provider and no filesystem.
export interface ProfileGuessStore {
  load(): Promise<string>;
  save(text: string): Promise<void>;
}

export interface ProfileGuessDeps {
  profile: ProfileGuessStore;
  run: SubagentTurnFn;
  model?: SubagentModel;
  signal?: AbortSignal;
  now?: () => number;
}

export interface ProfileGuessPassInput {
  topics: GuessTopicEvidence[];
  feedback: FeedbackEvent[];
}

// Why a pass did nothing before it reached the model.
export type GuessSkip = "unparseable-profile" | "no-evidence";

export type ProfileGuessResult =
  | { ran: false; skipped: GuessSkip }
  | {
      ran: true;
      ok: boolean;
      outcome: SubagentOutcome;
      // Whether the file changed. False on a pass that made no tool call, and on
      // one whose new set renders identically to the old.
      wrote: boolean;
      guesses: number;
      // Entries the model sent that the rules above threw away.
      dropped: number;
      failure?: string;
    };

// One pass. Rejects only for cancellation (StoppedError, raised by the
// capability); every other way of not finishing comes back in `ok`.
//
// The order matters: the document is parsed BEFORE the model is called, so an
// unparseable profile costs nothing and, more to the point, cannot be handed to
// a run that would then have somewhere to put its answer.
export async function runProfileGuessPass(
  input: ProfileGuessPassInput,
  deps: ProfileGuessDeps,
): Promise<ProfileGuessResult> {
  const now = deps.now ?? Date.now;
  const text = await deps.profile.load();
  const split = splitProfile(text);
  // Markers that do not parse: treat the whole file as the reader's and write
  // nothing. Splicing on a guessed boundary is how the declared half would be
  // lost, and it would be lost silently.
  if (!split.ok) return { ran: false, skipped: "unparseable-profile" };

  const topics = input.topics.filter((t) => t.entries.length > 0);
  if (topics.length === 0 && input.feedback.length === 0) {
    return { ran: false, skipped: "no-evidence" };
  }

  const today = new Date(now()).toISOString().slice(0, 10);
  const promptInput: ProfileGuessInput = {
    declared: declaredText(split),
    guesses: split.guesses,
    topics,
    feedback: input.feedback,
    today,
  };

  const captured: { sent: RawGuess[] | null } = { sent: null };
  const tools = [
    buildGuessTool((raw) => {
      // Last call wins: a model that calls twice meant the second one.
      captured.sent = raw;
    }),
  ];
  const brief = await runSubagent(
    {
      definition: buildGuessAgent(promptInput, tools, deps.model),
      task: buildGuessUserMessage(promptInput),
      signal: deps.signal,
    },
    // No ledger: nothing here is called by a model, and the sweep runs one pass
    // at a time (live.ts).
    { run: deps.run },
  );
  const ok = brief.outcome === "answered";
  if (!ok) {
    return {
      ran: true,
      ok: false,
      outcome: brief.outcome,
      wrote: false,
      guesses: split.guesses.length,
      dropped: 0,
      failure: brief.brief,
    };
  }
  // The pass finished and decided the set still holds.
  const raw = captured.sent;
  if (raw === null) {
    return {
      ran: true,
      ok: true,
      outcome: brief.outcome,
      wrote: false,
      guesses: split.guesses.length,
      dropped: 0,
    };
  }

  const guesses = normalizeGuesses(raw, {
    today,
    previous: split.guesses,
    declaredChars: declaredText(split).length,
  });
  const next = composeProfile(split, guesses);
  if (next !== text) await deps.profile.save(next);
  return {
    ran: true,
    ok: true,
    outcome: brief.outcome,
    wrote: next !== text,
    guesses: guesses.length,
    dropped: raw.length - guesses.length,
  };
}

// --- reading the profile back into a prompt ---

// The guess block as a prompt reads it, or "" when there are none. Same lines as
// the file: a guess without its basis and its date is not something a prompt can
// weigh.
export function guessPromptBlock(guesses: ProfileGuess[]): string {
  return guesses.map(renderGuessLine).join("\n");
}

// The two halves, for the prompts that inject the profile (the reading companion
// and the info triage). They must be injected separately: one is what the reader
// said, the other is what the AI made up about them, and a prompt that runs them
// together is a prompt that will act on a guess as if the reader had confirmed
// it — after which the guess is confirmed by the reader's reaction to a
// conversation it shaped. An unparseable file yields everything as declared,
// which is the safe direction here too.
export function profileForPrompt(text: string): { declared: string; guesses: string } {
  const split = splitProfile(text);
  return { declared: declaredText(split).trim(), guesses: guessPromptBlock(split.guesses) };
}
