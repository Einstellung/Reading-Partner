// Line diff and the three-way chunking the prose merge runs on. Written out
// rather than pulled in: the two devices must chunk the same files identically,
// and a dependency that updates on one of them first would quietly stop that
// from being true.

// A line carries its own terminator, so joining lines back is plain
// concatenation and a file with no final newline round-trips exactly.
export function splitLines(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

// Past this many differing lines the file is treated as changed end to end.
// Bounds the O(ND) walk; the cost of hitting it is a conflict copy, never a
// wrong merge.
const MAX_EDIT_DISTANCE = 4000;

// Myers' greedy diff. Returns the index pairs of a longest common subsequence,
// empty when the two are further apart than MAX_EDIT_DISTANCE.
function myers(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const pairs: [number, number][] = [];
  if (n === 0 || m === 0) return pairs;

  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = max;
  const size = 2 * max + 1;
  const v = new Int32Array(size);
  const trace: Int32Array[] = [];
  let found = -1;

  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const idx = offset + k;
      let x: number;
      if (k === -d || (k !== d && v[idx - 1] < v[idx + 1])) x = v[idx + 1];
      else x = v[idx - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[idx] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return [];

  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const before = trace[d];
    const k = x - y;
    const idx = offset + k;
    const prevK = k === -d || (k !== d && before[idx - 1] < before[idx + 1]) ? k + 1 : k - 1;
    const prevX = before[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      pairs.push([x, y]);
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    pairs.push([x, y]);
  }
  return pairs;
}

// Index in `a` -> index in `b` for the lines a longest common subsequence pairs
// up. The shared head and tail are matched directly, which is the whole job for
// the usual case of an edit appended to a note.
export function commonLines(a: string[], b: string[]): Map<number, number> {
  const matches = new Map<number, number>();
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) {
    matches.set(head, head);
    head++;
  }
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    matches.set(a.length - 1 - tail, b.length - 1 - tail);
    tail++;
  }
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  for (const [i, j] of myers(midA, midB)) matches.set(head + i, head + j);
  return matches;
}

// A stretch of the three files. A stable chunk is a run all three agree on. An
// unstable one is a stretch at least one side rewrote: the caller compares the
// three versions to decide whether it is a clean one-sided edit or a conflict.
export interface Chunk {
  stable: boolean;
  base: string[];
  local: string[];
  remote: string[];
}

// The diff3 chunking: align both sides against the base, then walk the base
// cutting at every point all three are back in step.
export function chunk3(base: string[], local: string[], remote: string[]): Chunk[] {
  const toLocal = commonLines(base, local);
  const toRemote = commonLines(base, remote);
  const chunks: Chunk[] = [];

  let b = 0;
  let l = 0;
  let r = 0;

  const emit = (stable: boolean, bEnd: number, lEnd: number, rEnd: number): void => {
    if (bEnd === b && lEnd === l && rEnd === r) return;
    chunks.push({
      stable,
      base: base.slice(b, bEnd),
      local: local.slice(l, lEnd),
      remote: remote.slice(r, rEnd),
    });
    b = bEnd;
    l = lEnd;
    r = rEnd;
  };

  for (;;) {
    // The next base line both sides still have: the first point the three can
    // be back in step.
    let sync = -1;
    for (let i = b; i < base.length; i++) {
      if (toLocal.has(i) && toRemote.has(i)) {
        sync = i;
        break;
      }
    }
    if (sync < 0) {
      emit(false, base.length, local.length, remote.length);
      return chunks;
    }
    const syncL = toLocal.get(sync) as number;
    const syncR = toRemote.get(sync) as number;
    emit(false, sync, syncL, syncR);

    let run = 0;
    while (
      b + run < base.length &&
      toLocal.get(b + run) === l + run &&
      toRemote.get(b + run) === r + run
    ) {
      run++;
    }
    emit(true, b + run, l + run, r + run);
  }
}
