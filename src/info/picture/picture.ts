// The picture, as maths: apply an analyst's delta to it, read drift out of it,
// and print it small enough for a prompt. Pure, unit-tested; the file is
// store.ts next door.
//
// Everything here is written to survive model-shaped garbage. A delta arrives
// from a language model, and the one thing it must never do is throw halfway
// through and leave the room without a picture — so a field of the wrong type,
// an id naming nothing, a likelihood word nobody uses are dropped with a warning
// and the rest of the delta still lands.

import {
  CONFIDENCES,
  LIKELIHOODS,
  PICTURE_VERSION,
  type Confidence,
  type Judgment,
  type Likelihood,
  type Observable,
  type OpenQuestion,
  type Picture,
  type PictureDelta,
} from "./types";

/** Where a likelihood word sits on the ladder. -1 for a word off it. */
export function likelihoodRank(l: string): number {
  return (LIKELIHOODS as readonly string[]).indexOf(l);
}

/** A room that has read nothing yet. `updatedAt` is 0 until something lands. */
export function emptyPicture(labId: string): Picture {
  return {
    version: PICTURE_VERSION,
    labId,
    baseline: "",
    observables: [],
    judgments: [],
    openQuestions: [],
    updatedAt: 0,
  };
}

export interface ApplyOptions {
  /** Local date of the run, stamped on everything the delta adds. */
  date: string;
  /** ms, for updatedAt. */
  now: number;
  /** Injected so a test can pin the minted ids. */
  random?: () => number;
}

export interface ApplyResult {
  picture: Picture;
  /** One line per thing that was dropped, in the order it was met. */
  warnings: string[];
}

const HEX = "0123456789abcdef";
// The most recent cable ids kept on an observable. Enough to say what the last
// departure was; the cables themselves live in the day files.
const MAX_HIT_CABLES = 5;

/**
 * Fold an analyst's delta into the picture. Never throws: an unusable piece is
 * a warning and the rest still applies.
 *
 * Order is fixed — baseline, adds, hits, retires, judgments, questions — so an
 * observable added by this same delta can be hit by a later run but not by this
 * one, which is what keeps the ids in `hit` meaning what the analyst saw.
 */
export function applyDelta(
  picture: Picture,
  delta: PictureDelta,
  opts: ApplyOptions,
): ApplyResult {
  const warnings: string[] = [];
  const random = opts.random ?? Math.random;
  const raw = delta as unknown as Record<string, unknown> | null;
  const observables = picture.observables.map((o) => ({ ...o }));
  const judgments = picture.judgments.map((j) => ({ ...j }));
  const openQuestions = picture.openQuestions.map((q) => ({ ...q }));
  const taken = new Set<string>([
    ...observables.map((o) => o.id),
    ...judgments.map((j) => j.id),
    ...openQuestions.map((q) => q.id),
  ]);

  const obsRaw = raw?.observables;
  const obs = isObject(obsRaw) ? obsRaw : {};
  const baseline = raw?.baseline;
  const nextBaseline =
    typeof baseline === "string" && baseline.trim() !== "" ? baseline.trim() : picture.baseline;

  for (const entry of asArray(obs.add)) {
    const text = asText(isObject(entry) ? entry.text : undefined);
    if (text === "") {
      warnings.push("observable add with no text");
      continue;
    }
    const base = asText(isObject(entry) ? entry.baseline : undefined);
    const o: Observable = {
      id: mintId("o-", taken, random),
      text,
      addedOn: opts.date,
    };
    if (base !== "") o.baseline = base;
    observables.push(o);
  }

  for (const entry of asArray(obs.hit)) {
    const id = asText(isObject(entry) ? entry.id : undefined);
    const target = observables.find((o) => o.id === id);
    if (!target) {
      warnings.push(`hit on unknown observable ${id || "(none)"}`);
      continue;
    }
    if (target.retiredOn !== undefined) {
      warnings.push(`hit on retired observable ${id}`);
      continue;
    }
    const cables = asArray(isObject(entry) ? entry.cables : undefined)
      .map((c) => asText(c))
      .filter((c) => c !== "");
    target.lastHitOn = opts.date;
    target.lastHitCables = [...new Set([...cables, ...(target.lastHitCables ?? [])])].slice(
      0,
      MAX_HIT_CABLES,
    );
  }

  for (const entry of asArray(obs.retire)) {
    const id = asText(entry);
    const target = observables.find((o) => o.id === id);
    if (!target) {
      warnings.push(`retire of unknown observable ${id || "(none)"}`);
      continue;
    }
    // Retiring twice is not a mistake worth a line: the second run simply says
    // again that nobody is watching this.
    if (target.retiredOn === undefined) target.retiredOn = opts.date;
  }

  for (const entry of asArray(raw?.judgments)) {
    const e = isObject(entry) ? entry : {};
    const text = asText(e.text);
    if (text === "") {
      warnings.push("judgment with no text");
      continue;
    }
    const likelihood = asText(e.likelihood);
    if (!(LIKELIHOODS as readonly string[]).includes(likelihood)) {
      warnings.push(`judgment "${short(text)}" dropped: likelihood ${likelihood || "(none)"}`);
      continue;
    }
    const confidence = asText(e.confidence);
    if (!(CONFIDENCES as readonly string[]).includes(confidence)) {
      warnings.push(`judgment "${short(text)}" dropped: confidence ${confidence || "(none)"}`);
      continue;
    }
    const j: Judgment = {
      id: mintId("j-", taken, random),
      text,
      likelihood: likelihood as Likelihood,
      confidence: confidence as Confidence,
      date: opts.date,
      cables: asArray(e.cables)
        .map((c) => asText(c))
        .filter((c) => c !== ""),
    };
    const supersedes = asText(e.supersedes);
    if (supersedes !== "") {
      // An unknown ancestor costs the link, not the judgment: the reading is
      // still the room's, it just no longer says what it replaces.
      if (judgments.some((prev) => prev.id === supersedes)) j.supersedes = supersedes;
      else warnings.push(`judgment "${short(text)}" supersedes unknown ${supersedes}`);
    }
    const rationale = asText(e.rationale);
    if (rationale !== "") j.rationale = rationale;
    judgments.push(j);
  }

  const questionsRaw = raw?.openQuestions;
  const questions = isObject(questionsRaw) ? questionsRaw : {};
  for (const entry of asArray(questions.add)) {
    const text = asText(entry);
    if (text === "") {
      warnings.push("open question with no text");
      continue;
    }
    openQuestions.push({ id: mintId("q-", taken, random), text, askedOn: opts.date });
  }
  for (const entry of asArray(questions.answered)) {
    const id = asText(entry);
    const target = openQuestions.find((q) => q.id === id);
    if (!target) {
      warnings.push(`answer to unknown question ${id || "(none)"}`);
      continue;
    }
    if (target.answeredOn === undefined) target.answeredOn = opts.date;
  }

  return {
    picture: {
      ...picture,
      baseline: nextBaseline,
      observables,
      judgments,
      openQuestions,
      updatedAt: opts.now,
      lastRunDate: opts.date,
    },
    warnings,
  };
}

export interface DriftAlert {
  /** The newest judgment in the chain. */
  judgmentId: string;
  /** The ids that climbed, oldest first. */
  chain: string[];
}

/**
 * Where the room has talked itself up. A judgment that supersedes another, which
 * supersedes another, each time on a stronger word, is the shape of a picture
 * drifting with its own momentum rather than with the evidence (docs/63 质量规则).
 *
 * The chain reported is the longest rising run ending at the newest judgment:
 * three steps up after a step down is still three steps up.
 */
export function driftAlerts(picture: Picture): DriftAlert[] {
  const byId = new Map(picture.judgments.map((j) => [j.id, j]));
  const superseded = new Set(
    picture.judgments.map((j) => j.supersedes).filter((id): id is string => !!id),
  );
  const out: DriftAlert[] = [];
  for (const head of picture.judgments) {
    if (superseded.has(head.id)) continue;
    const chain: Judgment[] = [head];
    const seen = new Set<string>([head.id]);
    let cur: Judgment | undefined = head;
    while (cur?.supersedes && !seen.has(cur.supersedes)) {
      const prev: Judgment | undefined = byId.get(cur.supersedes);
      if (!prev) break;
      seen.add(prev.id);
      chain.unshift(prev);
      cur = prev;
    }
    let start = chain.length - 1;
    while (
      start > 0 &&
      likelihoodRank(chain[start - 1]!.likelihood) < likelihoodRank(chain[start]!.likelihood)
    ) {
      start--;
    }
    const rising = chain.slice(start);
    if (rising.length >= 3) out.push({ judgmentId: head.id, chain: rising.map((j) => j.id) });
  }
  return out;
}

export interface SummaryOptions {
  maxChars: number;
}

/**
 * The picture as prompt material. The order is fixed — baseline, live
 * observables newest hit first, the newest judgment of each chain, open
 * questions — so the same picture always prints the same string and the prefix
 * of a prompt built on it stays worth caching.
 *
 * Over budget, the oldest entries go first, wherever they sit: what the room
 * saw last week is what it can afford to leave out.
 */
export function pictureSummary(picture: Picture, opts: SummaryOptions): string {
  const superseded = new Set(
    picture.judgments.map((j) => j.supersedes).filter((id): id is string => !!id),
  );

  interface Entry {
    section: 0 | 1 | 2;
    when: string;
    line: string;
  }
  const entries: Entry[] = [];

  const live = picture.observables.filter((o) => o.retiredOn === undefined);
  const byRecency = [...live].sort((a, b) => {
    const ka = a.lastHitOn ?? "";
    const kb = b.lastHitOn ?? "";
    if (ka !== kb) return kb.localeCompare(ka);
    if (a.addedOn !== b.addedOn) return b.addedOn.localeCompare(a.addedOn);
    return a.id.localeCompare(b.id);
  });
  for (const o of byRecency) {
    const parts = [`- [${o.id}] ${o.text}`];
    if (o.baseline) parts.push(`normal: ${o.baseline}`);
    parts.push(o.lastHitOn ? `last hit ${o.lastHitOn}` : `no hit since ${o.addedOn}`);
    entries.push({ section: 0, when: o.lastHitOn ?? o.addedOn, line: parts.join(" — ") });
  }

  const newest = picture.judgments.filter((j) => !superseded.has(j.id));
  const byDate = [...newest].sort((a, b) =>
    a.date === b.date ? a.id.localeCompare(b.id) : b.date.localeCompare(a.date),
  );
  for (const j of byDate) {
    entries.push({
      section: 1,
      when: j.date,
      line: `- [${j.id}] ${j.text} — ${j.likelihood}, ${j.confidence} confidence, ${j.date}`,
    });
  }

  const open = picture.openQuestions.filter((q) => q.answeredOn === undefined);
  const byAsked = [...open].sort((a, b) =>
    a.askedOn === b.askedOn ? a.id.localeCompare(b.id) : b.askedOn.localeCompare(a.askedOn),
  );
  for (const q of byAsked) {
    entries.push({ section: 2, when: q.askedOn, line: `- ${q.text} (asked ${q.askedOn})` });
  }

  // The drop order: oldest first, and a stable tie-break so the same picture
  // always loses the same line.
  const dropOrder = entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) =>
      a.e.when === b.e.when ? a.i - b.i : a.e.when.localeCompare(b.e.when),
    )
    .map(({ e }) => e);

  let kept = new Set(entries);
  let out = render(picture.baseline, entries.filter((e) => kept.has(e)));
  for (const victim of dropOrder) {
    if (out.length <= opts.maxChars) break;
    kept = new Set([...kept].filter((e) => e !== victim));
    out = render(
      picture.baseline,
      entries.filter((e) => kept.has(e)),
    );
  }
  if (out.length > opts.maxChars) {
    return opts.maxChars <= 1 ? out.slice(0, opts.maxChars) : `${out.slice(0, opts.maxChars - 1)}…`;
  }
  return out;
}

const SECTION_HEADS = ["Watching:", "Judgments:", "Open questions:"] as const;

function render(baseline: string, entries: { section: 0 | 1 | 2; line: string }[]): string {
  const blocks: string[] = [];
  if (baseline.trim() !== "") blocks.push(`Baseline: ${baseline.trim()}`);
  for (let s = 0; s < SECTION_HEADS.length; s++) {
    const lines = entries.filter((e) => e.section === s).map((e) => e.line);
    if (lines.length === 0) continue;
    blocks.push([SECTION_HEADS[s] as string, ...lines].join("\n"));
  }
  return blocks.join("\n\n");
}

/** A stored picture read back. Null when the bytes are not one. */
export function parsePicture(raw: unknown): Picture | null {
  if (!isObject(raw)) return null;
  if (raw.version !== PICTURE_VERSION) return null;
  if (typeof raw.labId !== "string" || raw.labId === "") return null;
  const picture = emptyPicture(raw.labId);
  if (typeof raw.baseline === "string") picture.baseline = raw.baseline;
  if (typeof raw.updatedAt === "number") picture.updatedAt = raw.updatedAt;
  if (typeof raw.lastRunDate === "string") picture.lastRunDate = raw.lastRunDate;
  for (const entry of asArray(raw.observables)) {
    const o = readObservable(entry);
    if (o) picture.observables.push(o);
  }
  for (const entry of asArray(raw.judgments)) {
    const j = readJudgment(entry);
    if (j) picture.judgments.push(j);
  }
  for (const entry of asArray(raw.openQuestions)) {
    const q = readQuestion(entry);
    if (q) picture.openQuestions.push(q);
  }
  return picture;
}

function readObservable(entry: unknown): Observable | null {
  if (!isObject(entry)) return null;
  if (typeof entry.id !== "string" || entry.id === "") return null;
  if (typeof entry.text !== "string") return null;
  if (typeof entry.addedOn !== "string") return null;
  return entry as unknown as Observable;
}

function readJudgment(entry: unknown): Judgment | null {
  if (!isObject(entry)) return null;
  if (typeof entry.id !== "string" || entry.id === "") return null;
  if (typeof entry.text !== "string") return null;
  if (!(LIKELIHOODS as readonly string[]).includes(entry.likelihood as string)) return null;
  if (!(CONFIDENCES as readonly string[]).includes(entry.confidence as string)) return null;
  if (typeof entry.date !== "string") return null;
  if (!Array.isArray(entry.cables)) return null;
  return entry as unknown as Judgment;
}

function readQuestion(entry: unknown): OpenQuestion | null {
  if (!isObject(entry)) return null;
  if (typeof entry.id !== "string" || entry.id === "") return null;
  if (typeof entry.text !== "string") return null;
  if (typeof entry.askedOn !== "string") return null;
  return entry as unknown as OpenQuestion;
}

// --- reading a value nobody promised anything about ------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function short(text: string): string {
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

// A fresh id, minted until it is one the picture has not used. The loop is
// bounded because a random source a test pins can hand back the same digit
// forever; the counter suffix is then the id, which is ugly and unique.
function mintId(prefix: string, taken: Set<string>, random: () => number): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    let id = prefix;
    for (let i = 0; i < 6; i++) id += HEX[Math.floor(random() * 16) % 16];
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
  let n = 0;
  let id = `${prefix}${n}`;
  while (taken.has(id)) id = `${prefix}${++n}`;
  taken.add(id);
  return id;
}
