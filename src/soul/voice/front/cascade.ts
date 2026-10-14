// The cascade front (docs/companion/136 "两层"、"前台接口"): the call's turns
// answered by one short model call each, outside the durable runtime and never
// queued behind another turn on the conversation. It plugs into the existing
// driver (voice-call.ts) as its model and transcript ports, and takes the floor
// on its own through program turns: the sentence that says a result is back,
// and a result read out word for word.
//
// A reply can carry a sentence and a delegate together. The sentence is spoken
// as it streams, the call is carried out as soon as it arrives, nothing is fed
// back, and the turn ends. A reply that only hands off gets the filler line.

import type { ConversationEvent } from "../conversation";
import type { SessionEffect, SessionPhase, VoiceTurn } from "../voice-session";
import { INTERRUPTED_MARK } from "../voice-session";
import type { VoiceCallModel, VoiceCallTranscript } from "../voice-call";
import type { CallNote } from "../../think/contract";
import type { CallBack } from "./backend";
import { frontRequest } from "./context";
import type { CallLine, FrontCall, FrontListRow, FrontNote, HeardUpTo, VoiceFront } from "./contract";
import { fillerLine, type FillerPort } from "./filler";
import { frontMarks, monotonicNow, type MarkSink } from "./marks";
import type { FrontModel } from "./model";
import { buildFrontTools, type FrontActions } from "./tools";

/** The quiet before the front speaks up on its own (136 "回来"; a starting value). */
export const FRONT_GAP_MS = 2000;

/** What the driver lets the front see and do. */
export interface FrontFloor {
  /** Start a program turn if the floor is free. Resolves to whether it took it. */
  program(turn: number): Promise<boolean>;
}

/** A line the front writes to the conversation the call belongs to. */
export type FrontWriter = (line: { key: string; role: "user" | "ai"; text: string }) => void;

/** A result the reader asked to see on screen. */
export interface FrontCard {
  number: number;
  text: string;
}

export interface CascadeFrontDeps {
  model: FrontModel;
  backend: CallBack;
  /** Where the call is held, as the front is told it. */
  place: () => string;
  /** The conversation file. Read-outs are not written: the result is in it already. */
  write: FrontWriter;
  filler: FillerPort;
  /** The recogniser's locale, which the filler line is said in. */
  locale: string;
  marks: MarkSink;
  onShow: (card: FrontCard) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => () => void;
  gapMs?: number;
}

type Program =
  | { kind: "notify"; notes: FrontNote[] }
  | { kind: "read"; number: number; from: number };

export interface CascadeFront extends VoiceFront {
  model: VoiceCallModel;
  transcript: VoiceCallTranscript;
  bind(floor: FrontFloor): void;
  /** Every effect the driver performs, before it performs it. */
  observe(effect: SessionEffect): void;
  /** Every event the native call sends. */
  event(event: ConversationEvent): void;
  /** The numbered list as the front sees it now. */
  list(): FrontListRow[];
}

const BOUNDARY = /[。！？；.!?\n]/;

/** Where to pick a read-out up again: the start of the sentence it was cut in. */
export function resumeOffset(heard: string): number {
  const said = heard.endsWith(INTERRUPTED_MARK) ? heard.slice(0, -INTERRUPTED_MARK.length).trimEnd() : heard;
  for (let i = said.length - 2; i >= 0; i--) if (BOUNDARY.test(said[i]!)) return i + 1;
  return 0;
}

export function createCascadeFront(deps: CascadeFrontDeps): CascadeFront {
  const now = deps.now ?? monotonicNow;
  const setTimer =
    deps.setTimer ??
    ((fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    });
  const gap = deps.gapMs ?? FRONT_GAP_MS;
  const marks = frontMarks(deps.marks, now);

  let floor: FrontFloor | null = null;
  let phase: SessionPhase = "idle";
  let userSpeaking = false;
  let held = false;
  let quietSince = now();
  let nextProgram = -1;
  let timer: (() => void) | null = null;
  let unsubscribe: (() => void) | null = null;

  let lines: CallLine[] = [];
  let lineAt = new Map<string, number>();
  const programs = new Map<number, Program>();
  let notes: FrontNote[] = [];
  let reads: Program[] = [];
  // Where an interrupted read-out picks up again, by number.
  const resumeAt = new Map<number, number>();

  function list(): FrontListRow[] {
    return deps.backend
      .tasks()
      .slice(-10)
      .map((t) => ({
        number: t.n,
        task: t.task,
        status: t.state,
        ...(t.progress ? { progress: t.progress } : {}),
        ...(t.cover ? { cover: t.cover } : t.reason ? { cover: t.reason } : {}),
      }));
  }

  function context() {
    return { place: deps.place(), list: list(), lines };
  }

  // The floor is free for a read-out at once, and for a notice after the gap.
  function schedule(): void {
    timer?.();
    timer = null;
    if (!floor || (reads.length === 0 && notes.length === 0)) return;
    if (phase !== "listening" || userSpeaking) return;
    if (reads.length > 0) {
      void take();
      return;
    }
    if (held) return;
    const wait = quietSince + gap - now();
    if (wait <= 0) void take();
    else timer = setTimer(schedule, wait);
  }

  // One program turn asked for at a time: the floor answers asynchronously.
  let taking = false;

  async function take(): Promise<void> {
    if (!floor || taking) return;
    const program: Program | undefined = reads.length > 0 ? reads[0] : notes.length > 0 ? { kind: "notify", notes } : undefined;
    if (!program) return;
    const id = nextProgram--;
    programs.set(id, program);
    taking = true;
    const took = await floor.program(id).finally(() => {
      taking = false;
    });
    if (!took) {
      programs.delete(id);
      return;
    }
    if (program.kind === "read") {
      reads.shift();
      held = true;
    } else notes = [];
  }

  const actions: FrontActions = {
    async cancel(n) {
      const r = await deps.backend.cancel(n);
      return r.ok ? `#${n} called back.` : `#${n} not called back: ${r.reason ?? "unknown"}`;
    },
    async readOut(n) {
      const text = await deps.backend.text(n);
      if (!text) return `#${n} has nothing to read yet.`;
      reads.push({ kind: "read", number: n, from: resumeAt.get(n) ?? 0 });
      return `#${n} will be read out.`;
    },
    async show(n) {
      const text = await deps.backend.text(n);
      if (!text) return `#${n} has nothing to show yet.`;
      deps.onShow({ number: n, text });
      await deps.backend.told(n);
      return `#${n} is open on screen.`;
    },
  };
  const tools = buildFrontTools(deps.backend.delegateTool(), actions);
  const byName = new Map(tools.map((t) => [t.name, t]));

  async function readOut(program: Extract<Program, { kind: "read" }>, onDelta: (s: string) => void): Promise<void> {
    const text = await deps.backend.text(program.number);
    if (text) onDelta(text.slice(program.from));
  }

  async function notify(turn: number, program: Extract<Program, { kind: "notify" }>, req: Parameters<VoiceCallModel["ask"]>[0]): Promise<void> {
    const ctx = context();
    const { system, messages } = frontRequest(ctx);
    const about = program.notes
      .map((n) => `#${n.number} (${n.task}) ${n.outcome === "done" ? "is ready" : `failed: ${n.cover}`}`)
      .join("; ");
    messages.push({
      role: "user",
      text:
        `(Not said by the reader. ${about}. Tell the reader in one sentence, and for a ready one ask whether to read it ` +
        "out or show it. Do not say what it found.)",
    });
    await deps.model({
      system,
      messages,
      tools: [],
      signal: req.signal,
      onSent: () => marks.mark(turn, "request-sent"),
      onText: (chunk) => {
        marks.mark(turn, "first-byte");
        req.onDelta(chunk);
      },
      onToolCall: () => {},
    });
  }

  async function answer(req: Parameters<VoiceCallModel["ask"]>[0]): Promise<void> {
    const { turn } = req;
    const { system, messages } = frontRequest(context());
    // The opening line is asked with a note the driver never records.
    if (messages[messages.length - 1]?.role !== "user") messages.push({ role: "user", text: req.text });
    let said = false;
    let handed = false;
    const calls: Promise<void>[] = [];
    await deps.model({
      system,
      messages,
      tools,
      signal: req.signal,
      onSent: () => marks.mark(turn, "request-sent"),
      onText: (chunk) => {
        marks.mark(turn, "first-byte");
        if (chunk.trim()) said = true;
        req.onDelta(chunk);
      },
      onToolCall: ({ name, args }) => {
        const tool = byName.get(name);
        if (!tool) return;
        if (name === "delegate") marks.mark(turn, "delegate-sent");
        req.onActivity({ kind: "tool", name, phase: "start" });
        // Carried out whatever happens to the sentence: a barge-in cuts what
        // the front is saying, not what it handed off (136 一期).
        calls.push(
          tool
            .execute(args)
            .then(
              (out) => {
                if (name === "delegate") handed = true;
                console.info(`RP-FRONT tool ${name}: ${typeof out === "string" ? out : out.text}`);
              },
              (e) => console.warn(`RP-FRONT tool ${name} failed`, e),
            )
            .finally(() => req.onActivity({ kind: "tool", name, phase: "end" })),
        );
      },
    });
    await Promise.all(calls);
    if (handed && !said && !req.signal.aborted) {
      if (!(await deps.filler.play("thinking", deps.locale))) req.onDelta(fillerLine("thinking", deps.locale));
    }
  }

  const model: VoiceCallModel = {
    async ask(req) {
      const program = programs.get(req.turn);
      try {
        if (program?.kind === "read") await readOut(program, req.onDelta);
        else if (program?.kind === "notify") await notify(req.turn, program, req);
        else await answer(req);
      } finally {
        marks.flush(req.turn, program ? (program.kind === "read" ? "read-out" : "notify") : undefined);
      }
    },
  };

  function keep(entry: VoiceTurn): void {
    const key = `${entry.turn}:${entry.role}`;
    const program = programs.get(entry.turn);
    const line: CallLine = {
      role: entry.role,
      text: entry.text,
      ...(entry.interrupted ? { interrupted: true } : {}),
      ...(program?.kind === "read" ? { readOut: String(program.number) } : {}),
    };
    const at = lineAt.get(key);
    if (at === undefined) {
      lineAt.set(key, lines.length);
      lines.push(line);
    } else lines[at] = line;
    if (program?.kind === "read") {
      if (entry.interrupted) {
        resumeAt.set(program.number, program.from + resumeOffset(entry.text));
      } else {
        resumeAt.delete(program.number);
        void deps.backend.told(program.number);
      }
      held = false;
      return;
    }
    deps.write({ key, role: entry.role, text: entry.text });
  }

  const transcript: VoiceCallTranscript = {
    begin() {
      lines = [];
      lineAt = new Map();
    },
    record: keep,
  };

  function onNote(note: CallNote): void {
    front.notify({
      number: note.n,
      task: note.task,
      outcome: note.status,
      cover: note.status === "done" ? note.cover : note.reason,
    });
  }

  const front: CascadeFront = {
    id: "cascade",
    turnTaking: "local",
    speech: "tts",
    model,
    transcript,
    list,
    async open(c: FrontCall) {
      void c;
      unsubscribe = deps.backend.subscribe(onNote);
    },
    bind(f) {
      floor = f;
    },
    notify(note) {
      if (!notes.some((n) => n.number === note.number)) notes.push(note);
      schedule();
    },
    // The cascade's barge-in is the driver's: the session cuts the sentence
    // being said and nothing else. Nothing for the front to do on top.
    interrupt(heard: HeardUpTo) {
      void heard;
    },
    hold(on) {
      held = on;
      if (!on) schedule();
    },
    observe(effect) {
      if (effect.type === "speak-push") marks.mark(effect.turn, "first-sentence-to-tts");
      if (effect.type === "orb") {
        phase = effect.phase;
        if (phase === "listening") quietSince = now();
        schedule();
      }
    },
    event(e) {
      if (e?.kind === "speech-duck") userSpeaking = true;
      // The quiet is counted from whoever stopped last.
      if (e?.kind === "speech-resume" || e?.kind === "speech-stop" || e?.kind === "speech-end") {
        userSpeaking = false;
        quietSince = now();
      }
      if (e?.kind === "speech-end" && typeof e.text === "string" && e.text.trim()) marks.mark(e.turn, "speech-end");
      schedule();
    },
    async close() {
      timer?.();
      timer = null;
      unsubscribe?.();
      unsubscribe = null;
      floor = null;
    },
  };
  return front;
}
