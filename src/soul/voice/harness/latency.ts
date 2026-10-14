// Reading a silent-bench run back (docs/platform/560): the rows Swift, Rust and
// the webview wrote, one clock, cut into turns and into the segments of
// "the user stopped talking → the first of the reply can be heard".
//
// Native and Rust rows are CLOCK_UPTIME_RAW already. Webview rows carry both
// their arrival on that clock (`t`) and their own performance.now()
// (`perfMs`); the `clock-sync` rows the driver writes give the offset between
// the two, and the webview's own time is used where it is known — the arrival
// is late by however busy the bridge was.

export interface Row {
  t: number;
  src: "native" | "rust" | "js";
  ev: string;
  [k: string]: unknown;
}

export function parseRows(text: string): Row[] {
  const rows: Row[] = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const r = JSON.parse(s) as Row;
      if (typeof r.t === "number" && typeof r.ev === "string") rows.push(r);
    } catch {
      // A line cut off by a killed app is the only kind there is; skip it.
    }
  }
  return rows;
}

/** performance.now() + offset = shared clock, from the tightest sync round trip. */
export function clockOffset(rows: Row[]): number | null {
  let best: { rtt: number; offset: number } | null = null;
  for (const r of rows) {
    if (r.src !== "js" || r.ev !== "clock-sync") continue;
    const { perf0, perf1, native } = r as unknown as { perf0: number; perf1: number; native: number };
    if (![perf0, perf1, native].every((v) => typeof v === "number")) continue;
    const rtt = perf1 - perf0;
    const offset = native - (perf0 + perf1) / 2;
    if (!best || rtt < best.rtt) best = { rtt, offset };
  }
  return best ? best.offset : null;
}

/** All rows on the shared clock, webview rows moved to their own time, sorted. */
export function alignRows(rows: Row[]): Row[] {
  const offset = clockOffset(rows);
  return rows
    .map((r) =>
      r.src === "js" && offset !== null && typeof r.perfMs === "number"
        ? { ...r, t: r.perfMs + offset, arrivedT: r.t }
        : r,
    )
    .sort((a, b) => a.t - b.t);
}

/**
 * The chain from "the user stopped" to "the reply can be heard", in order:
 * the recogniser calls the turn over (turnEnd), the text is final (finalized)
 * and sent (speechEndSent), the front hears it (frontHeard), its request goes
 * out (request), the first byte comes back (firstByte), the first sentence goes
 * to TTS (firstSentence), the TTS request for the first sentence goes out
 * (ttsRequested), its first audio comes back (ttsFirstAudio), leaves the relay
 * (ttsHanded), reaches Swift (enqueue) and is put on the node (scheduled), and
 * the speaker carries it (audible). A milestone that never happened leaves its
 * segment empty and the chain goes on from the last one that did.
 *
 * `field` takes the time from a field of the row instead of its stamp: the
 * `tts-first` row is written when the piece is scheduled and carries the
 * earlier stages beside it, all on the same clock.
 */
export const MILESTONES: { key: string; src: Row["src"]; ev: string; field?: string; match?: (r: Row) => boolean }[] = [
  { key: "turnEnd", src: "native", ev: "turn-end" },
  { key: "finalized", src: "native", ev: "finalized" },
  { key: "speechEndSent", src: "native", ev: "conv:speech-end" },
  { key: "frontHeard", src: "js", ev: "front:speech-end" },
  { key: "request", src: "js", ev: "front:request-sent" },
  { key: "firstByte", src: "js", ev: "front:first-byte" },
  { key: "firstSentence", src: "js", ev: "front:first-sentence-to-tts" },
  { key: "ttsRequested", src: "native", ev: "tts-first", field: "req" },
  { key: "ttsFirstAudio", src: "native", ev: "tts-first", field: "firstAudio" },
  { key: "ttsHanded", src: "native", ev: "tts-first", field: "handed" },
  { key: "enqueue", src: "native", ev: "enqueue" },
  { key: "scheduled", src: "native", ev: "tts-first" },
  { key: "audible", src: "native", ev: "audible-start" },
];

export interface TurnLatency {
  clip: string;
  expect: string;
  text: string;
  speechEnd: number;
  /** Milestone → time on the shared clock. */
  at: Record<string, number>;
  /** Segment "a→b" → ms, between consecutive milestones that happened. */
  segments: Record<string, number>;
  /** User stopped → reply audible. Null when it never became audible. */
  totalMs: number | null;
  /** Interrupt and backchannel steps: from the clip's start. */
  duckMs?: number | null;
  stopMs?: number | null;
  silencedMs?: number | null;
  interrupted?: boolean;
  /** Tool calls in the window, by name, with their durations. */
  tools: { name: string; ms: number | null }[];
  /** A turn that handed work off: user stopped → delegate sent, and → the first thing heard. */
  delegateMs?: number | null;
  fillerMs?: number | null;
  /** Whether that first thing was the program's cue rather than the front's own sentence. */
  cue?: boolean;
  /** Times the speaker ran dry inside a sentence, and the silence that cost. */
  dry: number;
  drySilentMs: number;
}

/** One handed-off task: delegate sent → came back → the front says so → heard. */
export interface TaskLatency {
  number: number;
  status: string;
  sent: number;
  /** Delegate sent → the result is back (the CallNote). */
  backMs: number | null;
  /** Back → the front's notice turn starts. */
  notifyMs: number | null;
  /** Notice turn start → audible. */
  heardMs: number | null;
  /** Delegate sent → audible notice. */
  totalMs: number | null;
}

function first(rows: Row[], from: number, until: number, pred: (r: Row) => boolean): Row | undefined {
  return rows.find((r) => r.t >= from && r.t < until && pred(r));
}

export function turnsOf(raw: Row[]): TurnLatency[] {
  const rows = alignRows(raw);
  const feeds = rows.filter((r) => r.src === "js" && r.ev === "step-feed");
  const starts = rows.filter((r) => r.src === "native" && r.ev === "clip-start");
  const ends = rows.filter((r) => r.src === "native" && r.ev === "clip-speech-end");
  const turns: TurnLatency[] = [];
  ends.forEach((end, i) => {
    const clip = String(end.name ?? "");
    const start = starts.filter((s) => s.name === clip && s.t <= end.t).pop();
    const nextStart = starts.find((s) => s.t > end.t);
    const until = nextStart ? nextStart.t : Number.POSITIVE_INFINITY;
    const feed = feeds.filter((f) => f.clip === clip && f.t <= end.t).pop();
    const at: Record<string, number> = {};
    const segments: Record<string, number> = {};
    let prevKey = "speechEnd";
    let prevT = end.t;
    for (const m of MILESTONES) {
      const hit = first(rows, prevT, until, (r) => r.src === m.src && r.ev === m.ev && (!m.match || m.match(r)));
      if (!hit) continue;
      const t = m.field === undefined ? hit.t : hit[m.field];
      if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) continue;
      at[m.key] = t;
      segments[`${prevKey}→${m.key}`] = t - prevT;
      prevKey = m.key;
      prevT = t;
    }
    const expect = String(feed?.expect ?? "turn");
    const turn: TurnLatency = {
      clip,
      expect,
      text: String(feed?.text ?? ""),
      speechEnd: end.t,
      at,
      segments,
      totalMs: at.audible !== undefined ? at.audible - end.t : null,
      tools: [],
      dry: 0,
      drySilentMs: 0,
    };
    const inTurn = (r: Row) => r.t >= end.t && r.t < until;
    for (const r of rows) {
      if (!inTurn(r) || r.src !== "native") continue;
      if (r.ev === "tts-dry") turn.dry += 1;
      if (r.ev === "tts-resumed" && typeof r.silentMs === "number") turn.drySilentMs += r.silentMs;
    }
    const delegated = first(rows, end.t, until, (r) => r.src === "js" && r.ev === "front:delegate-sent");
    if (delegated) {
      const heard = first(rows, end.t, until, (r) => r.src === "native" && r.ev === "audible-start");
      const cue = first(rows, end.t, until, (r) => r.src === "rust" && r.ev === "cue");
      turn.delegateMs = delegated.t - end.t;
      turn.fillerMs = heard ? heard.t - end.t : null;
      turn.cue = Boolean(cue && (!heard || cue.t <= heard.t));
    }
    if (start && expect !== "turn") {
      const from = start.t;
      const duck = first(rows, from, until, (r) => r.src === "native" && r.ev === "conv:speech-duck");
      const stop = first(rows, from, until, (r) => r.src === "native" && r.ev === "conv:speech-stop");
      const silenced = first(rows, from, until, (r) => r.src === "native" && r.ev === "audible-end");
      turn.duckMs = duck ? duck.t - from : null;
      turn.stopMs = stop ? stop.t - from : null;
      turn.silencedMs = silenced ? silenced.t - from : null;
      turn.interrupted = Boolean(stop);
    }
    for (const s of rows.filter((r) => r.t >= end.t && r.t < until && r.src === "js" && r.ev === "tool-start")) {
      const back = first(rows, s.t, Number.POSITIVE_INFINITY, (r) => r.src === "js" && r.ev === "tool-end" && r.name === s.name);
      turn.tools.push({ name: String(s.name), ms: back ? back.t - s.t : null });
    }
    turns.push(turn);
    void i;
  });
  return turns;
}

/** Every handed-off task in a run, matched by its number from the delegate's answer. */
export function tasksOf(raw: Row[]): TaskLatency[] {
  const rows = alignRows(raw);
  const out: TaskLatency[] = [];
  for (const done of rows.filter((r) => r.src === "js" && r.ev === "front:delegate-done")) {
    const n = Number(/task (\d+)/.exec(String(done.out ?? ""))?.[1]);
    if (!Number.isFinite(n)) continue;
    const sent = [...rows].reverse().find((r) => r.src === "js" && r.ev === "front:delegate-sent" && r.t <= done.t && r.turn === done.turn);
    const from = sent ? sent.t : done.t;
    const note = first(rows, from, Number.POSITIVE_INFINITY, (r) => r.src === "js" && r.ev === "front:note" && r.number === n);
    const notify = note
      ? first(rows, note.t, Number.POSITIVE_INFINITY, (r) => r.src === "js" && r.ev === "front:notify" && Array.isArray(r.numbers) && r.numbers.includes(n))
      : undefined;
    const heard = notify ? first(rows, notify.t, Number.POSITIVE_INFINITY, (r) => r.src === "native" && r.ev === "audible-start") : undefined;
    out.push({
      number: n,
      status: String(note?.status ?? "running"),
      sent: from,
      backMs: note ? note.t - from : null,
      notifyMs: note && notify ? notify.t - note.t : null,
      heardMs: notify && heard ? heard.t - notify.t : null,
      totalMs: heard ? heard.t - from : null,
    });
  }
  return out;
}

/** Nearest-rank percentile. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

export interface SegmentStat {
  segment: string;
  n: number;
  p50: number | null;
  p90: number | null;
}

/** p50/p90 over the turns that were meant to start one, segment by segment, plus the total. */
export function summarize(turns: TurnLatency[]): SegmentStat[] {
  const real = turns.filter((t) => t.expect === "turn");
  const order: string[] = [];
  const values = new Map<string, number[]>();
  for (const t of real) {
    for (const [k, v] of Object.entries(t.segments)) {
      if (!values.has(k)) {
        values.set(k, []);
        order.push(k);
      }
      values.get(k)!.push(v);
    }
  }
  const totals = real.map((t) => t.totalMs).filter((v): v is number => v !== null);
  const stats = order.map((segment) => {
    const v = values.get(segment)!;
    return { segment, n: v.length, p50: percentile(v, 50), p90: percentile(v, 90) };
  });
  stats.push({ segment: "TOTAL speechEnd→audible", n: totals.length, p50: percentile(totals, 50), p90: percentile(totals, 90) });
  return stats;
}

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "-" : Math.round(v).toString());

export function formatReport(turns: TurnLatency[], tasks: TaskLatency[] = []): string {
  const lines: string[] = [];
  lines.push("turn  expect     total  clip / text");
  turns.forEach((t, i) => {
    let extra = "";
    if (t.expect !== "turn") {
      extra = `  duck ${fmt(t.duckMs)} stop ${fmt(t.stopMs)} silenced ${fmt(t.silencedMs)} interrupted=${t.interrupted}`;
    }
    const tools = t.tools.length ? `  tools ${t.tools.map((x) => `${x.name}:${fmt(x.ms)}`).join(",")}` : "";
    const handed =
      t.delegateMs !== undefined ? `  delegate ${fmt(t.delegateMs)} filler ${fmt(t.fillerMs)}${t.cue ? " (cue)" : ""}` : "";
    const dry = t.dry ? `  dry ${t.dry}x ${fmt(t.drySilentMs)}ms` : "";
    lines.push(`${String(i).padStart(4)}  ${t.expect.padEnd(9)} ${fmt(t.totalMs).padStart(6)}  ${t.clip} ${t.text}${extra}${tools}${handed}${dry}`);
  });
  lines.push("");
  lines.push("segment                                  n     p50     p90");
  for (const s of summarize(turns)) {
    lines.push(`${s.segment.padEnd(38)} ${String(s.n).padStart(3)} ${fmt(s.p50).padStart(7)} ${fmt(s.p90).padStart(7)}`);
  }
  const handed = turns.map((t) => t.fillerMs).filter((v): v is number => typeof v === "number");
  if (handed.length) {
    lines.push(`${"hard question→filler heard".padEnd(38)} ${String(handed.length).padStart(3)} ${fmt(percentile(handed, 50)).padStart(7)} ${fmt(percentile(handed, 90)).padStart(7)}`);
  }
  if (tasks.length) {
    lines.push("");
    lines.push("task  status    sent→back  back→notify  notify→heard   total");
    for (const k of tasks) {
      lines.push(
        `${String(k.number).padStart(4)}  ${k.status.padEnd(8)} ${fmt(k.backMs).padStart(10)} ${fmt(k.notifyMs).padStart(12)} ${fmt(k.heardMs).padStart(13)} ${fmt(k.totalMs).padStart(7)}`,
      );
    }
  }
  return lines.join("\n");
}
