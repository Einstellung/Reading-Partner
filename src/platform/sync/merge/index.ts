// Scaffolding: the conservative merge every strategy falls back to — keep ours,
// park theirs beside it, delete nothing. Replaced strategy by strategy.

import type { MergeInput, MergeOutput } from "./contract";

// Non-cryptographic; it only names conflict copies, and it has to be the same
// on both devices, which rules out a clock or a device id.
function tag(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function conflictCopyPath(path: string, bytes: Uint8Array): string {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  const ext = dot > slash ? path.slice(dot) : "";
  const stem = dot > slash ? path.slice(0, dot) : path;
  return `${stem}.conflict-${tag(bytes)}${ext}`;
}

export function mergeFile(input: MergeInput): MergeOutput {
  return {
    merged: input.local,
    copies: [{ path: conflictCopyPath(input.path, input.remote), bytes: input.remote }],
    dropped: [],
    contested: true,
  };
}
