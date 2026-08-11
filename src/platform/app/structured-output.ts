// How often the model's machine-readable output is actually usable. Five places
// ask a model for structure — four have it write JSON in the reply body (lesson
// prep's plan, the notes chapter plan, the slides deck plan, the news triage),
// one goes through tool arguments (the agent loop's validateToolCall) — and
// every one of them repairs what it can before giving up. Until now both the
// repairs and the give-ups were silent, so the failure rate that decides whether
// those pipelines should move to tool calls was unmeasured.
//
// Each parse writes one line to the shared event log. There is no topic to
// attribute these to (a deck spans books, a briefing spans none, the agent loop
// knows nothing about topics), so they share one reserved stream — same writer,
// same format, same AppData directory, same exclusion from sync — under a topic
// id no real topic can have.
//
// The log records shape and counts only: never the reply, never a title, never
// a tool argument. The raw text goes no further than the pure measuring
// functions below; the caller hands it over and gets back numbers.

import { logEvent, type EventPayload, type EventType } from "./events";

// The reserved topic id these events are filed under: events-ai.jsonl. Topic ids
// are UUIDs, so this can never collide with one.
export const AI_EVENT_TOPIC = "ai";

// Where a structured reply was asked for. The unit `seen`/`kept` counts differs
// per site: prep-plan counts chapters + references + nominations, notes-plan
// counts chapters, slides-plan counts slides, info-triage counts item
// references across the four tiers, info-screen counts per-item verdicts in one
// screening batch. tool-args counts nothing.
export type ParseSite =
  | "prep-plan"
  | "notes-plan"
  | "slides-plan"
  | "info-screen"
  | "info-triage"
  | "tool-args";

// Why the output was unusable.
export type ParseFailure =
  // The reply holds nothing shaped like a JSON object.
  | "no-json"
  // The object never closes: the reply stops mid-value or inside a string.
  | "truncated"
  // JSON.parse rejected it for some other reason (a trailing comma, a quote
  // style, a comment).
  | "syntax"
  // Valid JSON, but an array/string/number where an object was required.
  | "not-object"
  // A well-formed object missing a field the caller needs, or holding it empty.
  | "missing-field"
  // The field was there with elements in it, and every element failed
  // validation — the shape was right and the contents were not.
  | "empty-result"
  // Tool arguments the tool's own schema rejected.
  | "bad-args";

// What a parse noticed on the way through. Filled by the parse functions, which
// take it as an optional out-parameter: they have to keep returning their result
// on success and throwing on failure, so the counts cannot come back as a return
// value.
export interface ParseTally {
  // Elements the model emitted in the collections this parse validates.
  seen: number;
  // Elements that survived validation and reached the result. `seen - kept` is
  // what the defensive parse dropped without telling anyone.
  kept: number;
  // Fields the parse substituted a default for rather than dropping the element
  // (a missing title, an unparseable year, an unknown slide kind). Not a
  // failure; a count of how far off the schema the model was.
  repaired: number;
  // Set by the parse when it rejects a structurally valid object, since only the
  // parse knows whether the field it needed was absent or merely unusable.
  fail?: "missing-field" | "empty-result";
}

export function newTally(): ParseTally {
  return { seen: 0, kept: 0, repaired: 0 };
}

// Just enough of a resolved model to attribute a failure to it.
export interface ModelRef {
  providerId: string;
  modelId: string;
}

// --- measuring (pure) ------------------------------------------------------

// Drop a markdown fence the model wrapped its answer in, so the prose measured
// around the JSON is real prose rather than the fence markers. Mirrors the most
// forgiving of the four extractors.
function stripFence(text: string): string {
  const m = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (m) return m[1];
  // A reply cut off before its closing fence still opened one, and the opening
  // marker would otherwise be counted as prose.
  const open = /^\s*```(?:json)?[ \t]*\n?/i.exec(text);
  return open ? text.slice(open[0].length) : text;
}

// The candidate JSON object: first "{" to last "}", the rule all four sites
// parse by. Null when there is no such span.
function jsonSlice(text: string): string | null {
  const s = stripFence(text).trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return s.slice(start, end + 1);
}

// Whether a JSON span is cut off rather than merely malformed: it ends inside a
// string, or with braces/brackets still open. Both are what a stream that
// stopped early looks like after the first-"{"-to-last-"}" slice, and they are
// the one failure class a retry reliably fixes.
export function looksTruncated(json: string): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const ch of json) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
  return inString || depth > 0;
}

// The JSON-layer verdict on a reply, or null when it does yield an object — in
// which case any failure is the caller's own schema check, not the syntax.
export function classifyJson(text: string): ParseFailure | null {
  // A reply that is valid JSON but not an object (an array of slides instead of
  // { slides: [...] }) has to be caught on the whole reply, because the
  // first-"{"-to-last-"}" slice below would quietly mine an inner object out of
  // it and answer a question nobody asked.
  try {
    const whole = JSON.parse(stripFence(text).trim());
    if (!whole || typeof whole !== "object" || Array.isArray(whole)) return "not-object";
  } catch {
    // Not a bare JSON value; the reply has prose or a fence around it, or is
    // malformed. Either way the slice decides.
  }
  const json = jsonSlice(text);
  if (json === null) return "no-json";
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return looksTruncated(json) ? "truncated" : "syntax";
  }
  return data && typeof data === "object" ? null : "not-object";
}

// The full verdict on a failed parse: the JSON layer first, then whatever the
// parse itself concluded about a structurally valid object.
function classifyOutcome(text: string, tally?: ParseTally): ParseFailure {
  return classifyJson(text) ?? tally?.fail ?? "missing-field";
}

// Whether the reply failed before anything schema-shaped could be looked at.
// The element counts and the trailing-prose measure mean nothing in that case
// and are logged as null rather than as a zero somebody would read as a fact.
function isJsonLayer(fail: ParseFailure): boolean {
  return fail === "no-json" || fail === "truncated" || fail === "syntax" || fail === "not-object";
}

// What the reply looked like around its JSON. Lengths and flags only.
export interface ReplyShape {
  // Length of the whole reply.
  chars: number;
  // The model wrapped the answer in a markdown fence despite being told not to.
  fence: boolean;
  // Non-whitespace characters of prose before the JSON object, after any fence
  // is discounted.
  pre: number;
  // The same after it.
  post: number;
}

export function replyShape(text: string): ReplyShape {
  const s = stripFence(text);
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  const found = start >= 0 && end > start;
  return {
    chars: text.length,
    fence: /```/.test(text),
    pre: found ? s.slice(0, start).trim().length : 0,
    post: found ? s.slice(end + 1).trim().length : 0,
  };
}

// --- reporting -------------------------------------------------------------

export interface ReportInput {
  site: ParseSite;
  model: ModelRef;
  // The model's raw reply. Measured here and nowhere else; only the numbers
  // derived from it are logged.
  text: string;
  tally?: ParseTally;
  // Absent when the parse succeeded. The value is never logged — a message can
  // quote the model — only the fact that there was one.
  error?: unknown;
}

type LogFn = (topicId: string, type: EventType, payload?: EventPayload) => void;

export interface ParseReporter {
  reportParse(input: ReportInput): void;
  // Sugar for a parse that signals failure by throwing: runs it, logs whichever
  // way it went, and leaves the result and the throw untouched.
  recordParse<T>(
    site: ParseSite,
    model: ModelRef,
    text: string,
    parse: (tally: ParseTally) => T,
  ): T;
  // The tool-argument path, wrapped around the validation call itself. There is
  // no reply to measure — pi hands back parsed arguments — so it records only
  // which tool and whether that tool's schema accepted them.
  recordToolArgs<T>(model: ModelRef, tool: string, validate: () => T): T;
}

export function createParseReporter(log: LogFn): ParseReporter {
  // Consecutive failures per site since that site last succeeded, so an event
  // can say which try it is without threading an attempt counter through four
  // pipelines and a watchdog. An `ok` with attempt > 1 is a retry that worked.
  const streak = new Map<ParseSite, number>();

  const nextAttempt = (site: ParseSite, ok: boolean): number => {
    const attempt = (streak.get(site) ?? 0) + 1;
    if (ok) streak.delete(site);
    else streak.set(site, attempt);
    return attempt;
  };

  const emit = (site: ParseSite, ok: boolean, model: ModelRef, rest: EventPayload): void => {
    log(AI_EVENT_TOPIC, "structured-parse", {
      site,
      ok,
      provider: model.providerId,
      model: model.modelId,
      attempt: nextAttempt(site, ok),
      ...rest,
    });
  };

  const reportToolArgs = (model: ModelRef, tool: string, ok: boolean): void => {
    emit("tool-args", ok, model, { fail: ok ? null : "bad-args", tool });
  };

  const reportParse = (input: ReportInput): void => {
    const { site, model, text, tally, error } = input;
    const ok = error === undefined;
    const fail = ok ? null : classifyOutcome(text, tally);
    // Nothing was validated, and on a cut reply what follows the last "}" is the
    // severed tail rather than trailing prose.
    const blind = fail !== null && isJsonLayer(fail);
    const shape = replyShape(text);
    emit(site, ok, model, {
      fail,
      chars: shape.chars,
      fence: shape.fence,
      pre: shape.pre,
      post: fail === "truncated" ? null : shape.post,
      seen: blind ? null : (tally?.seen ?? null),
      kept: blind ? null : (tally?.kept ?? null),
      repaired: blind ? null : (tally?.repaired ?? null),
    });
  };

  return {
    reportParse,

    recordParse<T>(
      site: ParseSite,
      model: ModelRef,
      text: string,
      parse: (tally: ParseTally) => T,
    ): T {
      const tally = newTally();
      try {
        const out = parse(tally);
        reportParse({ site, model, text, tally });
        return out;
      } catch (error) {
        reportParse({ site, model, text, tally, error });
        throw error;
      }
    },

    recordToolArgs<T>(model: ModelRef, tool: string, validate: () => T): T {
      try {
        const out = validate();
        reportToolArgs(model, tool, true);
        return out;
      } catch (e) {
        reportToolArgs(model, tool, false);
        throw e;
      }
    },
  };
}

// The app's reporter, bound to the event log. Fire-and-forget like every other
// event: instrumentation must never break the pipeline it observes.
const live = createParseReporter(logEvent);

export const reportParse = live.reportParse;
export const recordParse = live.recordParse;
export const recordToolArgs = live.recordToolArgs;
