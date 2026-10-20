import { expect, test } from "bun:test";
import { MaterialRegistry } from "../../../src/info/dossier/registry";
import { composePrompt, composeResult, type ComposeInput, type DeeperReads } from "../../../src/info/topic-search/compose";
import type { TopicModelCall } from "../../../src/info/topic-search/model-io";
import type { TopicSearchResultItem } from "../../../src/info/topic-search/result-types";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import { PAPER_FULL_CHARS, readPaperFull, type SourceDeps } from "../../../src/info/topic-search/verify";

const TOPIC = {
  id: "ts-1", name: "Proteins", concernId: null, scope: "", subtopics: [], want: [], avoid: [], judgments: [], anchors: [], queries: [], answers: [],
  status: "active", revision: 1, createdAt: 0, lastRunAt: null,
} as TopicSearch;
const signal = new AbortController().signal;

async function paperItems(n: number) {
  const registry = new MaterialRegistry("r", { write: async () => {} });
  const items: TopicSearchResultItem[] = [];
  for (let i = 1; i <= n; i++) {
    const id = `2610.0000${i}`;
    const m = await registry.register({
      url: `https://arxiv.org/abs/${id}`, title: `Paper ${i}`, author: "Ada Lovelace", publishedAt: null, reader: "arxiv",
      facts: { arxivId: id, depth: "abstract", body: "abstract only" }, sections: [{ heading: "Abstract", text: `Paper ${i} designs proteins.` }],
    });
    items.push({
      id: `E${i}`, key: `arxiv:${id}`, keys: [`arxiv:${id}`], kind: "paper", subtopic: null, title: `Paper ${i}`, titleFrom: "original", summary: null,
      facts: { kind: "paper", arxivId: id, authors: ["Ada Lovelace"], publishedAt: null, depth: "abstract" },
      links: { original: `https://arxiv.org/abs/${id}`, posts: [] }, materials: [m.id],
      verify: { status: "read", reason: null, discrepancies: [], checked: { match: 0, mismatch: 0, absent: 0 } }, continuing: null, score: 50,
    });
  }
  return { registry, items };
}

function written(items: TopicSearchResultItem[]): string {
  return JSON.stringify({
    overview: { text: "Protein design moved; see E1.", cites: ["E1"] },
    items: items.map((i) => ({ e: i.id, conclusion: `${i.title} designs proteins.`, body: ["What it did."], unknown: "Its results." })),
  });
}

test("asks past the cap are refused and the model is told the reads are used up", async () => {
  const { registry, items } = await paperItems(3);
  const read: string[] = [];
  const deeper: DeeperReads = {
    left: 1,
    cap: 1,
    read: async (id) => {
      read.push(id);
      const item = items.find((i) => i.id === id)!;
      if (item.facts.kind === "paper") item.facts = { ...item.facts, depth: "full" };
      return { ok: true };
    },
  };
  const input: ComposeInput = { topic: TOPIC, kind: "daily", items, registry, profile: [], questions: [], language: "", deeper };
  const calls: TopicModelCall[] = [];
  const model = async (call: TopicModelCall) => {
    calls.push(call);
    return calls.length === 1 ? JSON.stringify({ deeper: ["E2", "E3", "E9"] }) : written(items);
  };
  const out = await composeResult(input, model, signal, 5);
  expect(read).toEqual(["E2"]);
  expect(out.deeper).toEqual({ read: ["E2"], failed: [], refused: ["E3"] });
  expect(out.calls).toBe(2);
  expect(out.written).not.toBeNull();
  expect(calls[0].system).toContain("you may ask to read up to 1 of these papers in full: E1, E2, E3");
  expect(calls[1].tail?.join("\n")).toContain("- Refused: E3. This run's deeper reads are used up (1 of 1)");
  expect(calls[1].tail?.join("\n")).toContain("No more deeper reads: write the answer now.");
});

test("every prompt says how much of a paper was read and that the rest goes to unknown; no offer when none are left", async () => {
  const { registry, items } = await paperItems(1);
  const prompt = composePrompt({ topic: TOPIC, kind: "first", items, registry, profile: [], questions: [], language: "", deeper: { left: 0, cap: 5, read: async () => ({ ok: true }) } });
  expect(prompt.user).toContain("Paper read: the abstract only.");
  expect(prompt.system).toContain("say so in unknown and never guess it");
  expect(prompt.system).not.toContain("you may ask to read");
});

test("an answer that asks for nothing is the write-up; with no call left after it, a deeper ask is not taken", async () => {
  const { registry, items } = await paperItems(2);
  let reads = 0;
  const deeper: DeeperReads = { left: 5, cap: 5, read: async () => (reads++, { ok: true }) };
  const input: ComposeInput = { topic: TOPIC, kind: "daily", items, registry, profile: [], questions: [], language: "", deeper };
  const plain = await composeResult(input, async () => written(items), signal, 5);
  expect(plain.calls).toBe(1);
  expect(plain.written).not.toBeNull();
  const last = await composeResult(input, async () => JSON.stringify({ deeper: ["E1"] }), signal, 1);
  expect(reads).toBe(0);
  expect(last.written).toBeNull();
});

const HTML = (body: string) => `<html><head><title>Paper</title></head><body><article>${body}</article></body></html>`;

function sourceDeps(over: Partial<SourceDeps> & { html?: string }): SourceDeps {
  return {
    fetchText: async (url) => (url.startsWith("https://arxiv.org/html/") && over.html ? { status: 200, text: over.html } : { status: 404, text: "" }),
    openLink: async () => ({ ok: false, code: "not_found", reason: "not here" }),
    lookupRepo: async () => ({ kind: "skipped", reason: "quota" }),
    repoQuotaLeft: () => null,
    ...over,
  };
}

const KNOWN = { title: "Paper", authors: ["Ada Lovelace"], publishedAt: null, abstract: "We design proteins." };

test("a deeper read takes the whole HTML without the back matter, capped", async () => {
  const html = HTML(
    `<h2>Abstract</h2><p>We design proteins.</p><h2>1 Method</h2><p>${"We diffuse. ".repeat(3000)}</p>` +
      `<h2>2 Results</h2><p>${"It folds. ".repeat(3000)}</p><h2>References</h2><p>[1] Someone.</p>`,
  );
  const got = await readPaperFull("2610.00001", KNOWN, sourceDeps({ html }), signal);
  if (!got.ok) throw new Error(got.reason);
  expect(got.input.url).toBe("https://arxiv.org/html/2610.00001");
  expect(got.input.sections.map((s) => s.heading)).toEqual(["Abstract", "1 Method", "2 Results"]);
  expect(got.input.sections.slice(1).reduce((n, s) => n + s.text.length, 0)).toBe(PAPER_FULL_CHARS);
  expect(got.input.facts).toEqual({ arxivId: "2610.00001", depth: "full", body: `whole HTML, cut at ${PAPER_FULL_CHARS} characters` });
  expect(got.facts).toEqual({ kind: "paper", arxivId: "2610.00001", authors: ["Ada Lovelace"], publishedAt: null, depth: "full" });
});

test("without HTML a deeper read takes the PDF's text layer up to the references; with neither it fails", async () => {
  const text = `Title\n\n${"Method text. ".repeat(500)}\n\n${"Results text. ".repeat(500)}\n\nReferences\n\n[1] Someone.`;
  const asked: string[] = [];
  const got = await readPaperFull("2610.00002", KNOWN, sourceDeps({ readPdfText: async (url) => (asked.push(url), text) }), signal);
  if (!got.ok) throw new Error(got.reason);
  expect(asked).toEqual(["https://arxiv.org/pdf/2610.00002"]);
  expect(got.input.url).toBe("https://arxiv.org/pdf/2610.00002");
  expect(got.input.sections[0].heading).toBe("Abstract");
  expect(got.input.sections.slice(1).every((s) => s.heading?.startsWith("PDF part"))).toBe(true);
  expect(got.input.sections.map((s) => s.text).join("\n")).not.toContain("Someone");
  expect(got.input.facts.body).toBe("whole PDF");

  const none = await readPaperFull("2610.00003", KNOWN, sourceDeps({}), signal);
  expect(none.ok).toBe(false);
});
