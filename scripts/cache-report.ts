// Read-only summary of the prompt-cache lines in events-ai.jsonl.
// Nothing is written; the log is only read.
//
//   bun run cache-report.ts [path/to/events-ai.jsonl]
//
// Default path is the desktop app's AppData log:
//   Linux   ~/.local/share/com.xinyuan.readingpartner/events-ai.jsonl
//   macOS   ~/Library/Application Support/com.xinyuan.readingpartner/events-ai.jsonl
//
// Three tables:
//   1. by face      — hit rate and average tokens per turn, per surface
//   2. by gap       — hit rate against how long since the previous turn on the
//                     same thread, first round only (a later round of one tool
//                     loop follows the round before it by seconds and would
//                     drown the buckets that matter)
//   3. by retention — so two measurements taken under different settings are
//                     never averaged together by accident
//
// "hit" is token-weighted: cacheRead / (input + cacheRead + cacheWrite), i.e.
// the share of the prompt that was served from cache. "any" is the share of
// turns that read anything at all.

import { homedir } from "node:os";
import { join } from "node:path";

interface Line {
  ts: number;
  type: string;
  surface: string;
  thread: string;
  round: number;
  provider: string;
  model: string;
  retention: string;
  ok: boolean;
  input: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  cacheWrite1h: number | null;
  output: number | null;
  sinceMs: number | null;
  ms: number;
}

const DEFAULT_PATHS = [
  join(homedir(), ".local/share/com.xinyuan.readingpartner/events-ai.jsonl"),
  join(homedir(), "Library/Application Support/com.xinyuan.readingpartner/events-ai.jsonl"),
];

async function resolvePath(): Promise<string> {
  const given = process.argv[2];
  if (given) return given;
  for (const p of DEFAULT_PATHS) {
    if (await Bun.file(p).exists()) return p;
  }
  throw new Error(`no events-ai.jsonl found; pass one:\n  ${DEFAULT_PATHS.join("\n  ")}`);
}

interface Group {
  turns: number;
  withUsage: number;
  anyRead: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h: number;
  output: number;
}

function emptyGroup(): Group {
  return {
    turns: 0,
    withUsage: 0,
    anyRead: 0,
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cacheWrite1h: 0,
    output: 0,
  };
}

function add(g: Group, l: Line): void {
  g.turns++;
  if (l.cacheRead === null && l.cacheWrite === null && l.input === null) return;
  g.withUsage++;
  if ((l.cacheRead ?? 0) > 0) g.anyRead++;
  g.input += l.input ?? 0;
  g.cacheRead += l.cacheRead ?? 0;
  g.cacheWrite += l.cacheWrite ?? 0;
  g.cacheWrite1h += l.cacheWrite1h ?? 0;
  g.output += l.output ?? 0;
}

function pct(n: number, d: number): string {
  return d === 0 ? "  n/a" : `${((100 * n) / d).toFixed(1).padStart(5)}%`;
}

function num(n: number, d: number): string {
  return d === 0 ? "-" : Math.round(n / d).toLocaleString("en-US");
}

function table(title: string, rows: [string, Group][], keyWidth = 12): void {
  console.log(`\n${title}`);
  console.log(
    `${"".padEnd(keyWidth)} ${"turns".padStart(6)} ${"hit".padStart(6)} ${"any".padStart(6)} ` +
      `${"read/turn".padStart(10)} ${"write/turn".padStart(10)} ${"fresh/turn".padStart(10)} ${"prompt/turn".padStart(11)}`,
  );
  for (const [key, g] of rows) {
    const promptTokens = g.input + g.cacheRead + g.cacheWrite;
    console.log(
      `${key.padEnd(keyWidth)} ${String(g.turns).padStart(6)} ${pct(g.cacheRead, promptTokens)} ` +
        `${pct(g.anyRead, g.withUsage)} ${num(g.cacheRead, g.withUsage).padStart(10)} ` +
        `${num(g.cacheWrite, g.withUsage).padStart(10)} ${num(g.input, g.withUsage).padStart(10)} ` +
        `${num(promptTokens, g.withUsage).padStart(11)}`,
    );
  }
}

const BUCKETS: { label: string; max: number }[] = [
  { label: "first turn", max: -1 },
  { label: "<1min", max: 60_000 },
  { label: "1-5min", max: 5 * 60_000 },
  { label: "5-15min", max: 15 * 60_000 },
  { label: ">15min", max: Infinity },
];

function bucketOf(sinceMs: number | null): string {
  if (sinceMs === null) return "first turn";
  for (const b of BUCKETS) {
    if (b.max > 0 && sinceMs < b.max) return b.label;
  }
  return ">15min";
}

function grouped(lines: Line[], key: (l: Line) => string): [string, Group][] {
  const map = new Map<string, Group>();
  for (const l of lines) {
    const k = key(l);
    let g = map.get(k);
    if (!g) {
      g = emptyGroup();
      map.set(k, g);
    }
    add(g, l);
  }
  return [...map.entries()].sort((a, b) => b[1].turns - a[1].turns);
}

const path = await resolvePath();
const text = await Bun.file(path).text();
const lines: Line[] = [];
for (const raw of text.split("\n")) {
  if (!raw.trim()) continue;
  let parsed: Line;
  try {
    parsed = JSON.parse(raw) as Line;
  } catch {
    continue;
  }
  if (parsed.type === "prompt-cache") lines.push(parsed);
}

if (lines.length === 0) {
  console.log(`no prompt-cache lines in ${path}`);
  process.exit(0);
}

const first = new Date(lines[0].ts).toISOString();
const last = new Date(lines[lines.length - 1].ts).toISOString();
console.log(`${path}\n${lines.length} turns, ${first} .. ${last}`);

const all = emptyGroup();
for (const l of lines) add(all, l);
table("all", [["all", all]]);
table("by face", grouped(lines, (l) => l.surface));
table("by model", grouped(lines, (l) => `${l.provider}/${l.model}`), 34);
table("by retention", grouped(lines, (l) => l.retention), 12);

const firstRounds = lines.filter((l) => l.round === 1);
const byBucket = grouped(firstRounds, (l) => bucketOf(l.sinceMs));
const order = new Map(BUCKETS.map((b, i) => [b.label, i]));
byBucket.sort((a, b) => (order.get(a[0]) ?? 9) - (order.get(b[0]) ?? 9));
table("by gap since the previous turn on the same thread (round 1 only)", byBucket);

// The same split per face, since a five-minute expiry costs a 38k-token
// classroom prompt far more than it costs a short one.
for (const [surface] of grouped(firstRounds, (l) => l.surface)) {
  const rows = grouped(
    firstRounds.filter((l) => l.surface === surface),
    (l) => bucketOf(l.sinceMs),
  );
  rows.sort((a, b) => (order.get(a[0]) ?? 9) - (order.get(b[0]) ?? 9));
  table(`  gap x ${surface} (round 1 only)`, rows);
}

const rounds = grouped(lines, (l) => (l.round === 1 ? "round 1" : "round 2+"));
table("by round", rounds);

const with1h = lines.filter((l) => (l.cacheWrite1h ?? 0) > 0).length;
console.log(
  `\n${with1h} of ${lines.length} turns wrote anything with 1h retention` +
    (with1h === 0 ? " (so every write in this log is the 5-minute one)" : ""),
);
