// Merging a file two devices both edited. See contract.ts for the shape of the
// call and the two rules every strategy holds to; this is the dispatch and the
// last-resort strategy.
//
// One thing the contract's wording hides: "keep ours" cannot mean "keep the
// side the caller labelled local". Each device runs this with itself as local,
// so a rule reading `local` would leave the desktop holding one file and the
// iPad the other, forever. Everything here that has to choose chooses by
// content, and the copy the loser goes into is named from its own bytes, so
// both devices write the same file under the same name.

import { strategyFor, type ConflictCopy, type MergeInput, type MergeOutput } from "./contract";
import { mergeObject } from "./fields";
import { mergeProse } from "./prose";
import {
  lineCollection,
  mergeCollection,
  readCollection,
  recordShape,
  writeCollection,
} from "./records";
import {
  canonical,
  compareBytes,
  compareContent,
  decode,
  detectFormat,
  encode,
  hashBytes,
  isPlainObject,
  parseJson,
  sameBytes,
  serialize,
  type Json,
} from "./text";

export function conflictCopyPath(path: string, bytes: Uint8Array): string {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  const ext = dot > slash ? path.slice(dot) : "";
  const stem = dot > slash ? path.slice(0, dot) : path;
  return `${stem}.conflict-${hashBytes(bytes)}${ext}`;
}

function unchanged(bytes: Uint8Array): MergeOutput {
  return { merged: bytes, copies: [], dropped: [], contested: false };
}

// The three texts in the order a strategy should read layout off them: the base
// first, then the two sides by content. Both devices then take the file's
// indentation and its final newline from the same place.
function byContent(base: string | null, local: string, remote: string): (string | null)[] {
  return compareContent(local, remote) <= 0 ? [base, local, remote] : [base, remote, local];
}

// The merged content, written the way whichever input already says the same
// thing wrote it. A merge that only carried one side's edits across must hand
// back that side's bytes and not a fresh serialization of them: reflowing a
// file nobody reformatted would make it upload again on every pass. Null when
// the result is genuinely new.
function verbatim(value: Json, candidates: (string | null)[]): string | null {
  const want = canonical(value);
  let best: string | null = null;
  for (const candidate of candidates) {
    if (candidate === null) continue;
    const parsed = parseJson(candidate);
    if (parsed === undefined || canonical(parsed) !== want) continue;
    if (best === null || compareContent(candidate, best) < 0) best = candidate;
  }
  return best;
}

function write(value: Json, base: string | null, local: string, remote: string): Uint8Array {
  const order = byContent(base, local, remote);
  return encode(verbatim(value, order) ?? serialize(value, detectFormat(order)));
}

export function mergeFile(input: MergeInput): MergeOutput {
  // The two devices hold the same bytes: nothing to decide, and nothing is
  // being taken from either of them.
  if (sameBytes(input.local, input.remote)) return unchanged(input.local);

  const strategy = strategyFor(input.path);
  const merged =
    strategy === "records"
      ? mergeRecordFile(input)
      : strategy === "fields"
        ? mergeFieldFile(input)
        : strategy === "prose"
          ? mergeProseFile(input)
          : null;
  // A strategy returns null when the file is not the shape it merges —
  // unparseable JSON, a record with no identity, bytes that are not UTF-8. The
  // file then keeps its content whole instead of being half-understood.
  return merged ?? mergeOpaque(input);
}

// Neither file can be read, so one is kept whole and the other is parked beside
// it. Which one is kept is decided by content, so both devices keep the same one.
function mergeOpaque(input: MergeInput): MergeOutput {
  // Only one side moved: nothing is in contention, whatever the file holds.
  if (input.base !== null) {
    if (sameBytes(input.base, input.local)) return unchanged(input.remote);
    if (sameBytes(input.base, input.remote)) return unchanged(input.local);
  }
  const keepLocal = compareBytes(input.local, input.remote) <= 0;
  const merged = keepLocal ? input.local : input.remote;
  const parked = keepLocal ? input.remote : input.local;
  return {
    merged,
    copies: [{ path: conflictCopyPath(input.path, parked), bytes: parked }],
    dropped: [],
    contested: true,
  };
}

interface Texts {
  base: string | null;
  local: string;
  remote: string;
}

// Null when either side is not valid UTF-8. A base that cannot be decoded is
// treated as no base at all: without one nothing can be told from an addition,
// so nothing is deleted.
function texts(input: MergeInput): Texts | null {
  const local = decode(input.local);
  const remote = decode(input.remote);
  if (local === null || remote === null) return null;
  return { base: input.base === null ? null : decode(input.base), local, remote };
}

function mergeRecordFile(input: MergeInput): MergeOutput | null {
  const shape = recordShape(input.path);
  const t = texts(input);
  if (shape === null || t === null) return null;

  if (shape.kind === "lines") {
    const merged = mergeCollection(
      t.base === null ? null : lineCollection(t.base),
      lineCollection(t.local),
      lineCollection(t.remote),
    );
    const sample = byContent(t.base, t.local, t.remote).find((text) => !!text) ?? "";
    const eol = sample.includes("\r\n") ? "\r\n" : "\n";
    const body = merged.ids.join(eol);
    const text = body === "" ? "" : body + (sample.endsWith("\n") ? eol : "");
    return { merged: encode(text), copies: [], dropped: merged.dropped, contested: merged.contested };
  }

  const local = readCollection(parseJson(t.local), shape);
  const remote = readCollection(parseJson(t.remote), shape);
  if (local === null || remote === null) return null;
  // A base that no longer parses, or that predates the shape, is no base.
  const base = t.base === null ? null : readCollection(parseJson(t.base), shape);

  const merged = mergeCollection(base, local, remote);
  const written = writeCollection(merged, shape, base, local, remote);
  return {
    merged: write(written.value, t.base, t.local, t.remote),
    copies: [],
    dropped: written.dropped,
    contested: written.contested,
  };
}

function mergeFieldFile(input: MergeInput): MergeOutput | null {
  const t = texts(input);
  if (t === null) return null;
  const local = parseJson(t.local);
  const remote = parseJson(t.remote);
  if (!isPlainObject(local) || !isPlainObject(remote)) return null;
  const base = t.base === null ? undefined : parseJson(t.base);

  const merged = mergeObject(isPlainObject(base) ? base : undefined, local, remote, "");
  return {
    merged: write(merged.value, t.base, t.local, t.remote),
    copies: [],
    dropped: merged.dropped,
    contested: merged.contested,
  };
}

function mergeProseFile(input: MergeInput): MergeOutput | null {
  const t = texts(input);
  if (t === null) return null;
  // No base: no line can be shown to predate either side, so the two files
  // conflict as wholes and the one that loses is kept beside the winner.
  const result = mergeProse(t.base ?? "", t.local, t.remote);
  const copies: ConflictCopy[] = [];
  if (result.copy !== null) {
    const bytes = encode(result.copy);
    copies.push({ path: conflictCopyPath(input.path, bytes), bytes });
  }
  return { merged: encode(result.text), copies, dropped: [], contested: result.contested };
}
