// The structured-output measurement (src/platform/app/structured-output.ts):
// how a bad model reply is classified, what the event carries, and that the
// reply itself never reaches the log. The four parse functions are exercised
// through their real signatures so the tally reflects what they actually drop.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  AI_EVENT_TOPIC,
  classifyJson,
  createParseReporter,
  looksTruncated,
  newTally,
  replyShape,
  type ParseSite,
} from "../src/platform/app/structured-output";
import type { EventPayload, EventType } from "../src/platform/app/events";
import { parsePlan } from "../src/reading/prep/plan";
import { parseNotesPlan } from "../src/reading/notes/plan";
import { parseSlidePlan } from "../src/reading/slides/plan";
import { parseTriageResult } from "../src/info/briefing/triage";

const MODEL = { providerId: "anthropic", modelId: "claude-sonnet-4-5" };

interface Logged {
  topicId: string;
  type: EventType;
  payload: EventPayload;
}

function reporter() {
  const lines: Logged[] = [];
  const r = createParseReporter((topicId, type, payload = {}) => {
    lines.push({ topicId, type, payload });
  });
  return { r, lines };
}

// --- classification --------------------------------------------------------

test("a reply with no JSON object at all is no-json", () => {
  expect(classifyJson("I'm sorry, I can't do that.")).toBe("no-json");
  expect(classifyJson("")).toBe("no-json");
  expect(classifyJson("here is a { but never a close")).toBe("no-json");
});

test("a reply cut off mid-object is truncated, not syntax", () => {
  // The extractor slices to the last "}", which on a cut stream lands inside
  // the structure and leaves braces open.
  const cut = '{"chapters": [{"title": "Intro", "startPage": 1}, {"title": "Meth';
  expect(classifyJson(cut)).toBe("truncated");
});

test("a reply cut off inside a string is truncated", () => {
  expect(classifyJson('{"overview": "the day is mostly noise}')).toBe("truncated");
});

test("a brace inside a string does not fool the truncation scan", () => {
  expect(looksTruncated('{"a": "closing } brace"}')).toBe(false);
  expect(looksTruncated('{"a": "escaped \\" quote"}')).toBe(false);
});

test("malformed but complete JSON is syntax, not truncated", () => {
  expect(classifyJson('{"chapters": [1, 2,]}')).toBe("syntax");
  expect(classifyJson("{'chapters': []}")).toBe("syntax");
});

test("a top-level array where an object was required is not-object", () => {
  expect(classifyJson('[{"title": "a"}]')).toBe("not-object");
});

test("a parseable object classifies as nothing, so the caller's own check decides", () => {
  expect(classifyJson('{"chapters": []}')).toBe(null);
  expect(classifyJson('```json\n{"chapters": []}\n```')).toBe(null);
  expect(classifyJson('Sure! Here you go:\n{"chapters": []}\nHope that helps.')).toBe(null);
});

// --- shape -----------------------------------------------------------------

test("replyShape counts the fence and the prose around the object", () => {
  expect(replyShape('{"a":1}')).toEqual({ chars: 7, fence: false, pre: 0, post: 0 });

  const fenced = '```json\n{"a":1}\n```';
  const s = replyShape(fenced);
  expect(s.fence).toBe(true);
  expect(s.chars).toBe(fenced.length);
  // The fence markers are not counted as prose; a clean object inside one reads
  // as pre 0 / post 0.
  expect(s.pre).toBe(0);
  expect(s.post).toBe(0);

  const chatty = replyShape('Here is the plan:\n{"a":1}\nLet me know!');
  expect(chatty.fence).toBe(false);
  expect(chatty.pre).toBe("Here is the plan:".length);
  expect(chatty.post).toBe("Let me know!".length);
});

// --- the event -------------------------------------------------------------

test("a successful parse logs ok with the tally and no text", () => {
  const { r, lines } = reporter();
  const text = '{"chapters": [{"title": "Intro", "startPage": 1}]}';
  const out = r.recordParse("notes-plan", MODEL, text, (tally) => parseNotesPlan(text, 10, tally));

  expect(out).toHaveLength(1);
  expect(lines).toHaveLength(1);
  // Filed under the reserved topic id, not a real topic: events-ai.jsonl.
  expect(lines[0].topicId).toBe(AI_EVENT_TOPIC);
  expect(AI_EVENT_TOPIC).toBe("ai");
  expect(lines[0].type).toBe("structured-parse");
  expect(lines[0].payload).toEqual({
    site: "notes-plan",
    ok: true,
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    attempt: 1,
    fail: null,
    chars: text.length,
    fence: false,
    pre: 0,
    post: 0,
    seen: 1,
    kept: 1,
    repaired: 0,
  });
});

test("nothing in the payload is text from the reply", () => {
  const { r, lines } = reporter();
  const text = '{"title": "A Secret Book Title", "slides": [{"title": "Chapter one is about x", "kind": "title"}]}';
  r.recordParse("slides-plan", MODEL, text, (tally) => parseSlidePlan(text, tally));

  const dumped = JSON.stringify(lines[0].payload);
  expect(dumped).not.toContain("Secret");
  expect(dumped).not.toContain("Chapter one");
  // Only ids, flags and counts.
  for (const v of Object.values(lines[0].payload)) {
    expect(["string", "number", "boolean", "object"]).toContain(typeof v);
  }
});

test("a throwing parse logs the classified failure and still throws", () => {
  const { r, lines } = reporter();
  const text = "The survey is long; here is my plan in prose instead.";
  expect(() => r.recordParse("prep-plan", MODEL, text, (t) => parsePlan(text, t))).toThrow();
  expect(lines[0].payload.ok).toBe(false);
  expect(lines[0].payload.fail).toBe("no-json");
});

test("a field the model omitted reads as missing-field, one it filled with junk as empty-result", () => {
  const { r, lines } = reporter();

  const omitted = '{"chapters": [{"title": "Intro", "startPage": 1}]}';
  expect(() => r.recordParse("prep-plan", MODEL, omitted, (t) => parsePlan(omitted, t))).toThrow();
  expect(lines[0].payload.fail).toBe("missing-field");

  // references is there with entries in it; every entry lacks the title that
  // makes it usable, so all of them are dropped.
  const junk = '{"chapters": [], "references": [{"key": "1"}, {"key": "2"}]}';
  expect(() => r.recordParse("prep-plan", MODEL, junk, (t) => parsePlan(junk, t))).toThrow();
  expect(lines[1].payload.fail).toBe("empty-result");
  expect(lines[1].payload.seen).toBe(2);
  expect(lines[1].payload.kept).toBe(0);
});

test("silently dropped elements show up as kept falling short of seen", () => {
  const { r, lines } = reporter();
  // Two nominations, one naming a key the reference list never had. Today that
  // one vanishes without a word.
  const text = JSON.stringify({
    chapters: [{ index: 1, title: "Intro", startPage: 1 }],
    references: [{ key: "1", title: "A real paper", citedInChapters: [1] }],
    nominations: [
      { key: "1", reason: "load-bearing" },
      { key: "99", reason: "invented" },
    ],
  });
  r.recordParse("prep-plan", MODEL, text, (t) => parsePlan(text, t));
  expect(lines[0].payload.ok).toBe(true);
  expect(lines[0].payload.seen).toBe(4); // 1 chapter + 1 reference + 2 nominations
  expect(lines[0].payload.kept).toBe(3);
});

test("defaults the parse substituted are counted as repairs, not failures", () => {
  const { r, lines } = reporter();
  // No deck title, a slide with an unknown kind, and a slide asking for both an
  // illustration and a figure.
  const text = JSON.stringify({
    slides: [
      { title: "Opening", kind: "splash" },
      {
        title: "Both",
        kind: "content",
        bookId: "b1",
        illustration: { prompt: "a graph" },
        figure: { figId: "3" },
      },
    ],
  });
  r.recordParse("slides-plan", MODEL, text, (t) => parseSlidePlan(text, t));
  expect(lines[0].payload.ok).toBe(true);
  expect(lines[0].payload.kept).toBe(2);
  // missing deck title + unknown kind + illustration-and-figure
  expect(lines[0].payload.repaired).toBe(3);
});

test("triage records the refs it drops for naming ids that were never offered", () => {
  const { r, lines } = reporter();
  const ids = new Set(["a", "b"]);
  const text = JSON.stringify({
    overview: "A quiet day.",
    mustRead: [{ itemId: "a", reason: "worth it" }],
    oneLiners: [{ itemId: "ghost", line: "made up" }],
    outOfLane: [],
    filtered: [{ itemId: "b", category: "" }],
  });
  const tally = newTally();
  const parsed = parseTriageResult(text, ids, tally);
  r.reportParse({ site: "info-triage", model: MODEL, text, tally });

  expect(parsed.ok).toBe(true);
  expect(lines[0].payload.seen).toBe(3);
  expect(lines[0].payload.kept).toBe(2);
  expect(lines[0].payload.repaired).toBe(1); // the empty category became "other"
});

test("a triage reply with no overview is a missing field, not a syntax problem", () => {
  const { r, lines } = reporter();
  const text = '{"mustRead": [], "oneLiners": [], "outOfLane": [], "filtered": []}';
  const tally = newTally();
  const parsed = parseTriageResult(text, new Set(), tally);
  expect(parsed.ok).toBe(false);
  r.reportParse({ site: "info-triage", model: MODEL, text, tally, error: "missing overview" });
  expect(lines[0].payload.ok).toBe(false);
  expect(lines[0].payload.fail).toBe("missing-field");
});

// --- retries ---------------------------------------------------------------

test("attempt counts a site's failure streak, so an ok above 1 is a retry that worked", () => {
  const { r, lines } = reporter();
  const bad = "no json here";
  const good = '{"chapters": [{"title": "Intro", "startPage": 1}]}';
  const run = (text: string): void => {
    try {
      r.recordParse("notes-plan", MODEL, text, (t) => parseNotesPlan(text, 10, t));
    } catch {
      // The failure is the point.
    }
  };

  run(bad);
  run(bad);
  run(good);
  run(good);

  expect(lines.map((l) => [l.payload.ok, l.payload.attempt])).toEqual([
    [false, 1],
    [false, 2],
    [true, 3],
    [true, 1],
  ]);
});

test("each site keeps its own streak", () => {
  const { r, lines } = reporter();
  const bad = "no json here";
  const fail = (site: ParseSite): void => {
    try {
      r.recordParse(site, MODEL, bad, (t) => parseNotesPlan(bad, 10, t));
    } catch {
      // The failure is the point.
    }
  };
  fail("notes-plan");
  fail("slides-plan");
  fail("notes-plan");
  expect(lines.map((l) => l.payload.attempt)).toEqual([1, 1, 2]);
});

// --- tool arguments --------------------------------------------------------

test("tool arguments log which tool and whether the schema took them", () => {
  const { r, lines } = reporter();

  expect(r.recordToolArgs(MODEL, "read_page", () => ({ page: 3 }))).toEqual({ page: 3 });
  expect(() =>
    r.recordToolArgs(MODEL, "view_figure", () => {
      throw new Error("expected string, got number");
    }),
  ).toThrow();

  expect(lines[0].payload).toEqual({
    site: "tool-args",
    ok: true,
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    attempt: 1,
    fail: null,
    tool: "read_page",
  });
  expect(lines[1].payload.ok).toBe(false);
  expect(lines[1].payload.fail).toBe("bad-args");
  expect(lines[1].payload.tool).toBe("view_figure");
});
