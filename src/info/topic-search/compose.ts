// The write phase's sentences (docs/info/88 「结果」「简报书」): one model call
// writes the panorama and, per item, the PDB entry — a one-sentence
// conclusion (the brief's contents line and italic lede), two or three
// paragraphs with facts and judgements kept apart, and one sentence on what is
// not yet known. The earlier conclusions of the same topic go in beside the
// items, so a story already reported is carried on with what is new
// (yesterday, still, again) rather than told again. The program checks every
// number and date in them against the materials they cite, asks once more with
// the problems listed, and falls back to the program's own version when the
// second answer fails too. The fallback has no model sentence at all: the
// page shows the topic's name, a line that the write-up did not come out, and
// each item's title, facts line and links, all of which the file already has.
//
// How much of a paper was read is said per item, and the sentences may only
// stand on that. The first call may instead ask to read some papers in full
// (`deeper`): the program reads up to the run's cap, refuses the rest saying the
// reads are used up, and asks for the write-up again with the whole papers in.
// That round happens once and is not one of the two tries at the write-up.

import type { MaterialRegistry, RegisteredMaterial } from "../dossier/registry";
import { cut, material, missingNumbers, parseJsonReply, UNTRUSTED_RULE, type TopicModel } from "./model-io";
import { topicBlock } from "./rank-pool";
import type { PaperDepth, ResultFacts, ResultRunKind, TopicSearchResultItem } from "./result-types";
import type { TopicSearch } from "./types";
import { PAPER_FULL_CHARS } from "./verify";

/** Characters of an item's materials the write-up sees. */
const ITEM_MATERIAL_CHARS = 2400;
/** Characters of an item's materials the write-up sees once its paper was read in full: the whole read, the abstract beside it. */
const ITEM_FULL_CHARS = PAPER_FULL_CHARS + 4000;

/** One item's entry as the model wrote it. */
export interface WrittenItem {
  summary: string;
  body: string[];
  unknown: string | null;
}

/** An earlier issue's conclusion on the same topic, for the model to carry on from. */
export interface EarlierLine {
  date: string;
  title: string;
  summary: string;
}

/** Earlier conclusions handed to one write-up (88 「跨天延续」: initial value). */
export const EARLIER_LINES = 20;
/** Paragraphs one entry may have. */
const MAX_PARAGRAPHS = 3;

export interface Written {
  overview: { text: string; cites: string[] };
  items: Map<string, WrittenItem>;
  doubts: { text: string; item: string | null }[];
  /** Candidate questions the model judged to repeat an answer the reader already gave. */
  repeats: Set<string>;
}

/** The deeper reads the write-up may ask for (88 「看原文」). */
export interface DeeperReads {
  /** Papers this run may still read in full. */
  left: number;
  /** The run's cap, for the refusal. */
  cap: number;
  /** Read item E<n>'s paper in full; the item's materials and facts change in place. */
  read(itemId: string, signal: AbortSignal): Promise<{ ok: true } | { ok: false; reason: string }>;
}

/** What came of the deeper reads the write-up asked for, by item. */
export interface DeeperReport {
  read: string[];
  failed: string[];
  refused: string[];
}

/** The arXiv material of an item that is not yet read in full; what a deeper read reads. */
export function deepenableMaterial(item: TopicSearchResultItem, registry: MaterialRegistry): RegisteredMaterial | null {
  if (item.continuing) return null;
  for (const id of item.materials) {
    const m = registry.get(id);
    if (m?.reader === "arxiv" && typeof m.facts.arxivId === "string" && m.facts.depth !== "full") return m;
  }
  return null;
}

/** How much of an item's paper was read; null for an item with no paper. */
export function paperDepth(item: TopicSearchResultItem, registry: MaterialRegistry): PaperDepth | null {
  const depths = item.materials.map((id) => registry.get(id)).filter((m) => m?.reader === "arxiv").map((m) => m!.facts.depth);
  for (const d of ["full", "head", "abstract"] as const) if (depths.includes(d)) return d;
  return item.facts.kind === "paper" ? (item.facts.depth ?? "abstract") : null;
}

const DEPTH_LINE: Record<PaperDepth, string> = {
  abstract: "Paper read: the abstract only.",
  head: "Paper read: the abstract and the start of the body; excerpts below.",
  full: "Paper read: the whole paper, below.",
};

export interface ComposeInput {
  topic: TopicSearch;
  kind: ResultRunKind;
  items: readonly TopicSearchResultItem[];
  registry: MaterialRegistry;
  profile: readonly string[];
  /** Questions that may go out with this result, Q1 …, for the model to mark the ones already answered. */
  questions: readonly { id: string; text: string }[];
  language: string;
  /** What earlier issues already said on this topic, newest first. */
  earlier?: readonly EarlierLine[];
  /** Deeper reads the model may ask for; absent or none left: it is not offered. */
  deeper?: DeeperReads;
  /**
   * Items already in the same result file, written up earlier (a retry, or the
   * first look's slow part, adding to the first look's file): the overview
   * covers them beside `items`, so it speaks for the whole file; they get no
   * entry. Absent on a run that writes its own file.
   */
  alongside?: readonly TopicSearchResultItem[];
}

/**
 * The facts line as text, in full, for the prompt and for the number check: the
 * book prints the compact `factsLine` (facts-line.ts), which holds no number
 * this one lacks, so a sentence that passes the check can say any of them.
 */
export function factsText(f: ResultFacts): string {
  switch (f.kind) {
    case "paper":
      return `arXiv ${f.arxivId}; ${f.authors.join(", ")}; ${f.publishedAt ?? "date unknown"}`;
    case "repo":
      return f.lookedUp
        ? `${f.fullName}; ${f.stars} stars; ${f.forks} forks; last commit ${f.lastCommitAt ?? "none"}; release ${f.release ? `${f.release.tag} ${f.release.publishedAt ?? ""}` : "none"}; license ${f.license ?? "none"}`
        : `${f.fullName}; facts not looked up`;
    case "page":
      return `${f.host}${f.author ? `; ${f.author}` : ""}${f.publishedAt ? `; ${f.publishedAt}` : ""}`;
    case "post": {
      const c = f.counts;
      return `@${f.handle}; ${new Date(f.postedAt).toISOString()}; ${c.likes ?? 0} likes, ${c.reposts ?? 0} reposts, ${c.replies ?? 0} replies`;
    }
  }
}

/** What an item already in the file offers the overview's number check: what the prompt shows of it. */
function alongsideSources(item: TopicSearchResultItem): string[] {
  return [item.title, factsText(item.facts), item.summary ?? ""];
}

/** Everything an item's sentences may take a number from. */
function itemSources(item: TopicSearchResultItem, registry: MaterialRegistry, earlier: readonly EarlierLine[]): string[] {
  return [
    // Already checked against their own materials when they were written.
    ...earlier.map((e) => e.summary),
    item.title,
    factsText(item.facts),
    ...item.links.posts.map((p) => p.text),
    ...item.materials.map((m) => registry.text(m) ?? ""),
    ...item.verify.discrepancies.map((d) => `${d.says} ${d.difference ?? ""}`),
  ];
}

export function composePrompt(input: ComposeInput): { system: string; user: string } {
  const first = input.kind === "first";
  const offer = input.deeper && input.deeper.left > 0 ? input.items.filter((i) => deepenableMaterial(i, input.registry)).map((i) => i.id) : [];
  const system = [
    first
      ? "Write the panorama of a topic search's first run: what has been happening in this field lately, from the items below."
      : "Write today's update of a topic search: what is new since the last run, from the items below.",
    first
      ? "- overview: one paragraph, four to seven sentences, naming items by number (E1) where it draws on them."
      : "- overview: two or three sentences, naming items by number (E1) where it draws on them.",
    "- items: for every item that is not marked continuing (and, if you have something new to say, for a continuing one), a brief entry:",
    "  conclusion: one sentence, the finding. It is the item's line in the contents and its lede. Do not repeat the title.",
    "  body: two or three short paragraphs. Say what happened first, then what it likely means, kept apart. Judgements carry hedges (likely, probably, may); never write a guess as a fact. Do not repeat the facts line.",
    "  unknown: one sentence on what is not yet known or could not be checked.",
    "  A new story that first shows up today is told short, saying what is not yet known.",
    "- Earlier issues: when an item continues something listed under \"Said in earlier issues\", write only what is new and carry the rest with words like yesterday, still, again. Never restate what was said there.",
    "- doubts: questions for the reader where you could not tell whether they want this kind of thing; usually none.",
    "- repeats: the numbers of candidate questions (Q1 …) that ask something the reader already answered; usually none.",
    ...(input.alongside?.length
      ? [
          'Items listed under "Already in this result" were written up earlier in the same result. The overview covers them together with the new items and may name them by number; write no entries for them.',
        ]
      : []),
    "Rules: skip promotion, event hype and engagement bait; tell a thread as one piece; tell a quoting post together with what it quotes; where an item lists a discrepancy, say what the original actually shows, not what the post claimed.",
    "Every number and date you write must appear in the materials, posts or facts of the items you cite. Never derive one (no sums, no differences, no rounding).",
    "A paper item says how much of the paper was read. Conclude only from the part read: what its method does or what its results show beyond that is not known to you, so say so in unknown and never guess it.",
    ...(offer.length
      ? [
          `Before writing, you may ask to read up to ${input.deeper!.left} of these papers in full: ${offer.join(", ")}. Ask only where what was read is too little to say what the paper did or found. To ask, answer only {"deeper": ["E2"]}; the program reads them and asks you to write again. Otherwise write the answer below.`,
        ]
      : []),
    'Answer with JSON only: {"overview": {"text": "…", "cites": ["E1", "M3"]}, "items": [{"e": "E1", "conclusion": "…", "body": ["…", "…"], "unknown": "…", "cites": ["M3.§2"]}], "doubts": [{"text": "…", "e": "E2"}], "repeats": ["Q1"]}.',
    UNTRUSTED_RULE,
    input.language,
    // The sentences are in the book's language; what the materials call things stays as they call it.
    "Titles of papers, posts and repositories, and names you quote, stay in their original language; write everything else in the language above.",
  ]
    .filter(Boolean)
    .join("\n");
  const blocks = input.items.map((item) => {
    const lines = [`${item.id} · ${item.kind}${item.subtopic ? ` · subtopic ${item.subtopic}` : ""}${item.continuing ? " · continuing" : ""}`, `Title: ${item.title}`, `Facts: ${factsText(item.facts)}`];
    if (item.continuing) {
      const b = item.continuing.before;
      const a = item.continuing.after;
      lines.push(`Since the last report: likes ${b.likes ?? 0} -> ${a.likes ?? 0}, reposts ${b.reposts ?? 0} -> ${a.reposts ?? 0}`);
    }
    if (item.verify.status === "unread") lines.push(`The original was not read: ${item.verify.reason ?? ""}`);
    const depth = paperDepth(item, input.registry);
    if (depth) lines.push(DEPTH_LINE[depth]);
    for (const d of item.verify.discrepancies) {
      lines.push(d.verdict === "mismatch" ? `Discrepancy: the post says "${d.says}"; ${d.difference} (${d.evidence})` : `Not in the original: "${d.says}"`);
    }
    for (const p of item.links.posts.slice(0, 3)) lines.push(`Post @${p.handle}: ${cut(p.text, 400)}`);
    const whole = depth === "full";
    let left = whole ? ITEM_FULL_CHARS : ITEM_MATERIAL_CHARS;
    for (const id of item.materials) {
      const m = input.registry.get(id);
      for (const s of input.registry.sections(id)) {
        if (left <= 0) break;
        const text = cut(s.text, whole ? left : Math.min(left, 1200));
        left -= text.length;
        lines.push(`${s.id}${s.heading ? ` (${s.heading})` : ""}${m?.title ? ` of "${m.title}"` : ""}: ${text}`);
      }
    }
    return material(item.id, lines.join("\n"));
  });
  const questions = input.questions.map((q) => `${q.id}: ${q.text}`);
  const answered = input.topic.answers.map((a) => `- Asked "${a.asked}", answered "${a.answer}"`);
  const earlier = (input.earlier ?? []).map((e) => `- ${e.date} · ${e.title}: ${e.summary}`);
  const alongside = (input.alongside ?? []).map((item) =>
    material(
      item.id,
      [
        `${item.id} · ${item.kind}${item.subtopic ? ` · subtopic ${item.subtopic}` : ""}`,
        `Title: ${item.title}`,
        `Facts: ${factsText(item.facts)}`,
        ...(item.summary ? [`Conclusion: ${item.summary}`] : []),
      ].join("\n"),
    ),
  );
  const user = [
    topicBlock(input.topic, input.profile),
    "",
    "Items:",
    ...blocks,
    ...(questions.length ? ["", "Candidate questions:", ...questions] : []),
    ...(answered.length ? ["", "The reader's earlier answers:", ...answered] : []),
    ...(alongside.length ? ["", "Already in this result (no entries):", ...alongside] : []),
    ...(earlier.length ? ["", "Said in earlier issues (newest first):", ...earlier] : []),
  ].join("\n");
  return { system, user };
}

/** The reply read and checked; `problems` lists what failed, empty when it all passed. */
export function checkWritten(text: string, input: ComposeInput): { written: Written | null; problems: string[] } {
  let raw: unknown;
  try {
    raw = parseJsonReply(text);
  } catch (e) {
    return { written: null, problems: [`The reply was not JSON (${e instanceof Error ? e.message : String(e)}).`] };
  }
  const o = (raw ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  const byId = new Map(input.items.map((i) => [i.id, i]));
  const already = new Map((input.alongside ?? []).map((i) => [i.id, i]));
  const refOk = (r: string) => byId.has(r) || already.has(r) || input.registry.has(r);
  const earlier = input.earlier ?? [];

  const ov = (o.overview ?? {}) as Record<string, unknown>;
  const overviewText = typeof ov.text === "string" ? ov.text.trim() : "";
  const cites = Array.isArray(ov.cites) ? ov.cites.filter((c): c is string => typeof c === "string") : [];
  if (!overviewText) problems.push("The overview is missing.");
  const badCites = cites.filter((c) => !refOk(c));
  if (badCites.length) problems.push(`The overview cites numbers that do not exist: ${badCites.join(", ")}.`);
  const mentioned = [...new Set([...cites, ...(overviewText.match(/\bE\d+\b/g) ?? [])])];
  const named = mentioned.filter((c) => byId.has(c));
  const namedAlready = mentioned.filter((c) => already.has(c));
  const citedMaterials = cites.filter((c) => !byId.has(c) && !already.has(c) && input.registry.has(c));
  const overviewSources =
    named.length || namedAlready.length || citedMaterials.length
      ? [
          ...named.flatMap((e) => itemSources(byId.get(e)!, input.registry, earlier)),
          ...namedAlready.flatMap((e) => alongsideSources(already.get(e)!)),
          ...citedMaterials.map((m) => input.registry.text(m) ?? ""),
        ]
      : [...input.items.flatMap((i) => itemSources(i, input.registry, earlier)), ...[...already.values()].flatMap(alongsideSources)];
  const overviewMissing = missingNumbers(overviewText, overviewSources);
  if (overviewMissing.length) problems.push(`The overview has numbers its cited items do not hold: ${overviewMissing.join(", ")}.`);

  const entries = new Map<string, WrittenItem>();
  const list = Array.isArray(o.items) ? o.items : [];
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  for (const v of list) {
    const x = (v ?? {}) as Record<string, unknown>;
    const id = str(x.e);
    const item = byId.get(id);
    // "summary" is what this field was called before the brief (2026-10-15).
    const summary = str(x.conclusion) || str(x.summary);
    const body = (Array.isArray(x.body) ? x.body : typeof x.body === "string" ? [x.body] : [])
      .map(str)
      .filter(Boolean)
      .slice(0, MAX_PARAGRAPHS);
    const unknown = str(x.unknown) || null;
    if (!item || !summary || entries.has(id)) continue;
    // A continuing item may be carried on in a line; a new one needs its paragraphs.
    if (!item.continuing && body.length === 0) {
      problems.push(`${id} has a conclusion but no body paragraphs.`);
      continue;
    }
    const missing = missingNumbers([summary, ...body, unknown ?? ""].join("\n"), itemSources(item, input.registry, earlier));
    if (missing.length) problems.push(`${id}'s sentences have numbers its materials do not hold: ${missing.join(", ")}.`);
    else entries.set(id, { summary, body, unknown });
  }
  const lacking = input.items.filter((i) => !i.continuing && !entries.has(i.id) && !problems.some((p) => p.startsWith(`${i.id} `) || p.startsWith(`${i.id}'s`)));
  if (lacking.length) problems.push(`No entry for ${lacking.map((i) => i.id).join(", ")}.`);

  const doubts = (Array.isArray(o.doubts) ? o.doubts : [])
    .map((d) => (d ?? {}) as Record<string, unknown>)
    .filter((d) => typeof d.text === "string" && d.text.trim())
    .map((d) => ({ text: (d.text as string).trim().slice(0, 240), item: typeof d.e === "string" && byId.has(d.e) ? d.e : null }));
  const repeats = new Set((Array.isArray(o.repeats) ? o.repeats : []).filter((r): r is string => typeof r === "string"));
  if (problems.length) return { written: null, problems };
  return { written: { overview: { text: overviewText, cites }, items: entries, doubts, repeats }, problems };
}

/** The items a reply asks to read in full, those that can be; empty when it asks for none. */
export function askedDeeper(text: string, input: ComposeInput): string[] {
  let raw: unknown;
  try {
    raw = parseJsonReply(text);
  } catch {
    return [];
  }
  const list = (raw as { deeper?: unknown } | null)?.deeper;
  if (!Array.isArray(list)) return [];
  const byId = new Map(input.items.map((i) => [i.id, i]));
  const ids = list.filter((x): x is string => typeof x === "string").map((x) => x.trim());
  return [...new Set(ids)].filter((id) => {
    const item = byId.get(id);
    return !!item && deepenableMaterial(item, input.registry) !== null;
  });
}

/** Read what was asked, up to what is left; the line the next prompt carries says what came of each. */
async function readDeeper(asked: string[], deeper: DeeperReads, signal: AbortSignal, report: DeeperReport): Promise<string> {
  const granted = asked.slice(0, Math.max(0, deeper.left));
  report.refused.push(...asked.slice(granted.length));
  const failed: string[] = [];
  for (const id of granted) {
    const got = await deeper.read(id, signal);
    if (got.ok) report.read.push(id);
    else {
      report.failed.push(id);
      failed.push(`${id} (${got.reason})`);
    }
  }
  return [
    "Deeper reads:",
    ...(report.read.length ? [`- Read in full: ${report.read.join(", ")}. Their items above now hold the whole paper.`] : []),
    ...(failed.length ? [`- Could not be read: ${failed.join("; ")}. Write them from what was read.`] : []),
    ...(report.refused.length
      ? [`- Refused: ${report.refused.join(", ")}. This run's deeper reads are used up (${deeper.cap} of ${deeper.cap}); write them from what was read.`]
      : []),
    "No more deeper reads: write the answer now.",
  ].join("\n");
}

/**
 * Write, check, write again once with the problems, else null (the fallback).
 * A failed call counts as a failed answer. When the first answer asks for deeper
 * reads (and a call is left for the write-up after them), the papers are read
 * and the write-up asked for again; that round is not one of the two tries.
 * Answers the calls it made and what came of the deeper reads.
 */
export async function composeResult(
  input: ComposeInput,
  model: TopicModel,
  signal: AbortSignal,
  maxCalls: number,
): Promise<{ written: Written | null; calls: number; deeper: DeeperReport }> {
  let prompt = composePrompt(input);
  let note = "";
  let user = prompt.user;
  let calls = 0;
  let offered = !!input.deeper && input.deeper.left > 0;
  const deeper: DeeperReport = { read: [], failed: [], refused: [] };
  for (let attempt = 0; attempt < 2 && calls < maxCalls; attempt++) {
    calls++;
    let text: string;
    try {
      text = await model({ site: "write", system: prompt.system, user, signal });
    } catch (e) {
      if (signal.aborted) throw e;
      continue;
    }
    if (offered) {
      offered = false;
      const asked = askedDeeper(text, input);
      if (asked.length && calls < maxCalls) {
        note = await readDeeper(asked, input.deeper!, signal, deeper);
        prompt = composePrompt({ ...input, deeper: undefined });
        user = `${prompt.user}\n\n${note}`;
        attempt--;
        continue;
      }
    }
    const { written, problems } = checkWritten(text, input);
    if (written) return { written, calls, deeper };
    user = `${prompt.user}\n\n${note ? `${note}\n\n` : ""}Your previous answer had these problems; write it again:\n${problems.map((p) => `- ${p}`).join("\n")}`;
  }
  return { written: null, calls, deeper };
}
