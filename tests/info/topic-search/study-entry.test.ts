import { expect, test } from "bun:test";
import { MaterialRegistry } from "../../../src/info/dossier/registry";
import { checkWritten, composePrompt, composeResult, studyReadOrder, type ComposeInput } from "../../../src/info/topic-search/compose";
import { entryRead, quoteOccurs } from "../../../src/info/topic-search/entry-parts";
import type { TopicModelCall } from "../../../src/info/topic-search/model-io";
import type { TopicSearchResultItem } from "../../../src/info/topic-search/result-types";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import { PAPER_FULL_CHARS } from "../../../src/info/topic-search/verify";

const TOPIC: TopicSearch = {
  id: "ts-0a1b2c3d", name: "Mechanism discovery", concernId: null, scope: "AI that finds mechanisms", subtopics: [], want: [], avoid: [],
  judgments: [], anchors: [], queries: [], answers: [], status: "active", revision: 1, createdAt: 0, lastRunAt: null,
};
const STUDY: TopicSearch = { ...TOPIC, once: true };
const signal = new AbortController().signal;

const SECTIONS = [
  { heading: "Abstract", text: "We propose KeplerAgent, an agent that discovers equations." },
  { heading: "1 Introduction", text: "LLM methods lack explicit reasoning about the structure, which makes the discovery process brittle and opaque." },
  { heading: "4.5 Results", text: "KeplerAgent reaches 75% symbolic accuracy on clean data, PySR 40% and LLM-SR 30%." },
];

async function setup(depth: "abstract" | "head" | "full" = "head") {
  const registry = new MaterialRegistry("r", { write: async () => {} });
  const m = await registry.register({
    url: "https://arxiv.org/abs/2602.12259", title: "KeplerAgent", author: "Ada Lovelace", publishedAt: "2026-02-10", reader: "arxiv",
    facts: { arxivId: "2602.12259", depth, body: "abstract and HTML" }, sections: SECTIONS,
  });
  const other = await registry.register({
    url: "https://arxiv.org/abs/2601.00001", title: "Other", author: null, publishedAt: null, reader: "arxiv",
    facts: { arxivId: "2601.00001", depth: "abstract", body: "abstract only" }, sections: [{ heading: "Abstract", text: "It reaches 99%." }],
  });
  const item = (id: string, material: string, over: Partial<TopicSearchResultItem> = {}): TopicSearchResultItem => ({
    id, key: `arxiv:${id}`, keys: [`arxiv:${id}`], kind: "paper", subtopic: null, title: `Paper ${id}`, titleFrom: "original", summary: null,
    facts: { kind: "paper", arxivId: "2602.12259", authors: ["Ada Lovelace"], publishedAt: "2026-02-10", depth },
    links: { original: "https://arxiv.org/abs/2602.12259", posts: [] }, materials: [material],
    verify: { status: "read", reason: null, discrepancies: [], checked: { match: 0, mismatch: 0, absent: 0 } }, continuing: null, score: 60, ...over,
  });
  const items = [item("E1", m.id), item("E2", other.id, { score: 40 })];
  const input: ComposeInput = { topic: STUDY, kind: "first", items, registry, profile: [], questions: [], language: "" };
  return { registry, items, input, m: m.id, other: other.id };
}

const S = (text: string, cite: string[] = ["M1.§3"], quote?: string) => ({ text, cite, ...(quote ? { quote } : {}) });

function reply(e1: Record<string, unknown>, e2: Record<string, unknown> = { method: [S("It studies another thing.", ["M2"])] }) {
  return JSON.stringify({
    overview: { text: "Two papers; see E1 and E2.", cites: ["E1", "E2"] },
    items: [
      { e: "E1", conclusion: "An agent finds structure before it fits equations.", ...e1 },
      { e: "E2", conclusion: "Another paper.", ...e2 },
    ],
  });
}

const GOOD = {
  background: [S("Writing laws as formulas is a goal of science.", ["M1.§1"])],
  prior: [],
  gap: [S("Earlier LLM methods do not reason about structure; the authors call this brittle.", ["M1.§2"], "brittle and opaque")],
  method: [[S("A large language model agent picks the tools.", ["M1.§1"]), S("An algorithmic tool finds the symmetry.", ["M1.§2"])], [S("It stops at a set error.", ["M1.§1"])]],
  results: [S("75% on clean data, PySR 40%.")],
  helps: [S("It shows prior knowledge entering as constraints.", [])],
  cannot: [S("It does not choose the next experiment.", ["M1.§1"])],
  admitted: [],
  ours: [S("Accuracy is judged by a model.", [])],
};

test("a study's prompt asks for the seven parts with anchors; another topic's prompt is the short entry as before", async () => {
  const { input } = await setup();
  const study = composePrompt(input).system;
  expect(study).toContain("background: why this work is worth doing.");
  expect(study).toContain("who or what does it (the large language model, a named algorithmic tool, a human)");
  expect(study).toContain("Every sentence cites the sections (M3.§2) of this item's materials it stands on");
  expect(study).toContain("about 1200 characters in Chinese or Japanese");
  expect(study).toContain("must appear in the sections that sentence cites");
  expect(study).not.toContain("body: two or three short paragraphs");

  const plain = composePrompt({ ...input, topic: TOPIC }).system;
  expect(plain).toContain("body: two or three short paragraphs");
  expect(plain).toContain("say so in unknown and never guess it");
  expect(plain).not.toContain("background:");
});

test("a study entry's parts come back anchored; a material of one section may be cited whole; body holds the plain text", async () => {
  const { input } = await setup();
  const { written, problems } = checkWritten(reply(GOOD), input);
  expect(problems).toEqual([]);
  const e1 = written!.items.get("E1")!;
  expect(e1.parts!.gap).toEqual([{ text: GOOD.gap[0].text, cites: ["M1.§2"], quote: "brittle and opaque" }]);
  expect(e1.parts!.method.map((p) => p.length)).toEqual([2, 1]);
  expect(e1.parts!.relevance.helps[0].cites).toEqual([]);
  expect(e1.parts!.confidence).toEqual({ read: { depth: "head", cut: false, through: null }, admitted: [], ours: [{ text: "Accuracy is judged by a model.", cites: [] }], dropped: [] });
  expect(e1.unknown).toBeNull();
  expect(e1.body[0]).toBe("Writing laws as formulas is a goal of science.");
  expect(e1.body.join("\n")).not.toContain("M1");
  expect(written!.items.get("E2")!.parts!.method[0][0].cites).toEqual(["M2.§1"]);
});

test("a results number must be in the section the sentence cites; on the last try the sentence is dropped and recorded", async () => {
  const { input } = await setup();
  // 75 and 40 are in M1.§3, not in the introduction the sentence cites.
  const bad = reply({ ...GOOD, results: [S("75% on clean data, PySR 40%.", ["M1.§2"]), S("LLM-SR 30%.")] });
  const first = checkWritten(bad, input);
  expect(first.written).toBeNull();
  expect(first.problems).toEqual(['E1 results: "75% on clean data, PySR 40%." has numbers the sections it cites (M1.§2) do not hold: 75, 40.']);

  const last = checkWritten(bad, input, true);
  const parts = last.written!.items.get("E1")!.parts!;
  expect(parts.results.map((s) => s.text)).toEqual(["LLM-SR 30%."]);
  expect(parts.confidence.dropped).toEqual([{ part: "results", why: "number" }]);
});

test("quotes, anchors and uncited claims are checked; a reply that tells nothing of what was done is sent back even on the last try", async () => {
  const { input } = await setup();
  const check = (e1: Record<string, unknown>, final = false) => checkWritten(reply({ ...GOOD, ...e1 }), input, final);
  expect(check({ gap: [S("They call it fragile.", ["M1.§2"], "fragile and unclear")] }).problems).toEqual([
    'E1 gap: "They call it fragile." quotes words that are not in M1.§2.',
  ]);
  expect(check({ gap: [S("They call it brittle.", ["M1.§2"], "“lack explicit reasoning … brittle and opaque”")] }).problems).toEqual([]);
  expect(check({ prior: [S("Another paper did it.", ["M2.§1"])] }).problems).toEqual([
    'E1 prior: "Another paper did it." cites M2.§1, which is not a section of this item\'s materials.',
  ]);
  expect(check({ background: [S("Formulas matter.", [])] }).problems).toEqual(['E1 background: "Formulas matter." cites no section.']);
  expect(check({ background: [S("Formulas matter.", ["M1.§9"])] }, true).written!.items.get("E1")!.parts!.confidence.dropped).toEqual([
    { part: "background", why: "cite" },
  ]);
  const none = check({ method: [] }, true);
  expect(none.written).toBeNull();
  expect(none.problems).toEqual(["E1 has a conclusion but no method sentences."]);
});

test("a study's write-up that still fails a sentence on its second try keeps the entry without it; another topic's falls back", async () => {
  const { input } = await setup();
  const calls: TopicModelCall[] = [];
  const bad = reply({ ...GOOD, results: [S("75%, PySR 41%.")] });
  const out = await composeResult(input, async (c) => (calls.push(c), bad), signal, 5);
  expect(out.calls).toBe(2);
  expect(calls[1].tail?.join("\n")).toContain('E1 results: "75%, PySR 41%." has numbers the sections it cites (M1.§3) do not hold: 41.');
  expect(out.written!.items.get("E1")!.parts!.results).toEqual([]);
  expect(out.written!.items.get("E1")!.parts!.confidence.dropped).toEqual([{ part: "results", why: "number" }]);

  const plain = JSON.stringify({ overview: { text: "See E1.", cites: ["E1"] }, items: [{ e: "E1", conclusion: "It reached 41%.", body: ["It did."] }, { e: "E2", conclusion: "Another.", body: ["It did."] }] });
  const fallback = await composeResult({ ...input, topic: TOPIC }, async () => plain, signal, 5);
  expect(fallback.written).toBeNull();
});

test("a retry carries the previous answer and asks for corrections only; they are merged part by part", async () => {
  const { input } = await setup();
  const calls: TopicModelCall[] = [];
  const bad = reply({ ...GOOD, results: [S("75%, PySR 41%.")] });
  const fix = JSON.stringify({ items: [{ e: "E1", results: [S("75% on clean data, PySR 40%.")] }] });
  const answers = [bad, fix];
  const out = await composeResult(input, async (c) => (calls.push(c), answers.shift()!), signal, 5);
  expect(out.calls).toBe(2);
  const tail = calls[1].tail!.join("\n");
  expect(tail).toContain(`Your previous answer:\n${bad}`);
  expect(tail).toContain("Reply with the corrections only");
  const e1 = out.written!.items.get("E1")!.parts!;
  expect(e1.results.map((s) => s.text)).toEqual(["75% on clean data, PySR 40%."]);
  expect(e1.gap[0].quote).toBe("brittle and opaque");
  expect(e1.confidence.dropped).toEqual([]);
  expect(out.written!.items.get("E2")!.parts!.method[0][0].text).toBe("It studies another thing.");
  expect(out.written!.overview.text).toBe("Two papers; see E1 and E2.");
});

test("a reply that was not JSON is written again whole", async () => {
  const { input } = await setup();
  const calls: TopicModelCall[] = [];
  const answers = ["not json", reply(GOOD)];
  const out = await composeResult(input, async (c) => (calls.push(c), answers.shift()!), signal, 5);
  expect(out.written).not.toBeNull();
  expect(calls[1].tail!.join("\n")).toStartWith("Your previous answer had these problems; write it again:");
});

test("the read: a whole read that reached the cap was cut after its last section; a head read says nothing of sections", async () => {
  const registry = new MaterialRegistry("r", { write: async () => {} });
  const half = PAPER_FULL_CHARS / 2;
  const whole = await registry.register({
    url: "https://arxiv.org/html/2602.12259", title: "K", author: null, publishedAt: null, reader: "arxiv", facts: { arxivId: "2602.12259", depth: "full" },
    sections: [{ heading: "Abstract", text: "Short." }, { heading: "1 Introduction", text: "a".repeat(half) }, { heading: "A.2 Symmetry", text: "b".repeat(half) }],
  });
  expect(entryRead([whole.id], registry, "full")).toEqual({ depth: "full", cut: true, through: "A.2 Symmetry" });
  expect(entryRead([whole.id], registry, "head")).toEqual({ depth: "head", cut: false, through: null });
  expect(quoteOccurs("brittle  and\nopaque", "…process brittle and opaque.")).toBe(true);
});

test("a study reads its seeds' papers first, then by score, only those not read in full yet", async () => {
  const { registry, items } = await setup();
  const third = { ...items[1], id: "E3", key: "arxiv:2601.00001", keys: ["arxiv:2601.00001"], score: 10 };
  expect(studyReadOrder([...items, third], registry)).toEqual(["E1", "E2", "E3"]);
  expect(studyReadOrder([...items, third], registry, [{ key: "arxiv:2601.00001", title: "Other", said: "the other one", at: 0 }])).toEqual(["E3", "E1", "E2"]);
  const full = { ...items[0], materials: [] };
  expect(studyReadOrder([full, items[1]], registry)).toEqual(["E2"]);
});
