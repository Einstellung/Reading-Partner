// The night's input as bytes, and the hash of those bytes.
//
// The hash is what decides whether a model is called at all (docs/49, "判脏用
// 物化后的字节比对"): a database watermark says "nothing newer than X", which
// misses a record another device edited or deleted, and both of those are
// reasons to think again. Materializing the whole input and comparing bytes
// treats an edit, a deletion and an addition alike, because in this text they
// are alike.
//
// So the rendering has to be a function of the content and of nothing else. It
// numbers from 1 in both lists — those numbers are the only handle the model
// gets on a record (docs/49, "模型只交下标和动作") — and the order they number
// comes from candidates.ts, which sorts by id.

import { hashText } from "../../platform/sync/merge/text";
import type { DreamCandidates } from "./candidates";

export interface DreamMaterial {
  text: string;
  // FNV-1a over the text. Not cryptographic: it only has to differ when the
  // input differs, and the comparison it feeds is against this same machine's
  // own last run.
  hash: string;
}

const EMPTY = "(none)";

// A body is markdown and may be several lines; indenting keeps it from being
// read as a new numbered entry.
function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function observationLines(candidates: DreamCandidates): string {
  if (candidates.observations.length === 0) return EMPTY;
  const out: string[] = [];
  candidates.observations.forEach((o, i) => {
    out.push(`${i + 1}. ${o.id} | ${o.type} | ${o.created} | ${o.summary}`);
    const body = o.body.trim();
    if (body) out.push(indent(body));
  });
  return out.join("\n");
}

function statementLines(candidates: DreamCandidates): string {
  if (candidates.statements.length === 0) return EMPTY;
  // The author is shown because it decides what may be proposed against this
  // statement: what the reader said about themselves can be supported but not
  // superseded (proposals.ts). The model is told the rule rather than left to
  // have its proposal dropped by it.
  return candidates.statements
    .map(
      (s, i) =>
        `${i + 1}. ${s.id} | ${s.kind} | by ${s.author} | ${s.established}..${s.lastSupported} | ${s.text}`,
    )
    .join("\n");
}

export function materializeDream(candidates: DreamCandidates): DreamMaterial {
  const text = [
    "OBSERVATIONS NO STANDING STATEMENT RESTS ON YET:",
    observationLines(candidates),
    "",
    "STATEMENTS THAT STAND:",
    statementLines(candidates),
    "",
  ].join("\n");
  return { text, hash: hashText(text) };
}
