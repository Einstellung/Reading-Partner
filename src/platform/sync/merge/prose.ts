// The prose strategy: every .md the user writes or reads — chapter notes, prep
// digests, the info profile, AI observations. A three-way merge per line, so two
// devices that wrote in different places both keep what they wrote.
//
// Where they wrote over each other, one version goes into the file and the
// other side's whole file is written out beside it. No <<<<<<< markers: these
// files are rendered in the app and edited by hand, and a marker left in one
// would be read as text forever.

import { chunk3, splitLines } from "./diff";
import { compareContent } from "./text";

export interface ProseMerge {
  text: string;
  // The losing side's whole file, or null when no hunk was contested.
  copy: string | null;
  contested: boolean;
}

function same(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function mergeProse(base: string, local: string, remote: string): ProseMerge {
  // One side wins every contested hunk, so the file stays coherent and there is
  // one copy to read rather than one per hunk. Which side is decided by
  // content, never by which device is running.
  const localWins = compareContent(local, remote) <= 0;

  const chunks = chunk3(splitLines(base), splitLines(local), splitLines(remote));
  const out: string[] = [];
  let contested = false;

  for (const chunk of chunks) {
    if (chunk.stable) {
      out.push(...chunk.base);
      continue;
    }
    if (same(chunk.local, chunk.base)) {
      out.push(...chunk.remote);
      continue;
    }
    if (same(chunk.remote, chunk.base)) {
      out.push(...chunk.local);
      continue;
    }
    if (same(chunk.local, chunk.remote)) {
      out.push(...chunk.local);
      continue;
    }
    contested = true;
    out.push(...(localWins ? chunk.local : chunk.remote));
  }

  const text = out.join("");
  if (!contested) return { text, copy: null, contested: false };
  const loser = localWins ? remote : local;
  return { text, copy: loser === text ? null : loser, contested: true };
}
