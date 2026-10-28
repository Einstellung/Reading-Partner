// The prep's voice (docs/671 时间线与语音): what the front is told while a run is
// under way, its two tools, the meals conversation's start_prep, the timer
// prompts and the chat card's view.
//
// Facts never go through the model (docs/671 事实不经模型): the front's list has
// numbers, words, devices and states but no clock times or minutes; every
// sentence about the schedule is built here from timeline/view.ts and goes to
// the call's `say`, which speaks it as it is. The model only hands in events.

import { Type } from "@earendil-works/pi-ai";

import { t } from "../../i18n";
import type { AgentTool } from "../../legion/durable/contract";
import type { MealsPrepCardData } from "./cards";
import type { PrepRun } from "./plan/types";
import type { RecordedEvent } from "./prep-progress";
import { msToNextMinute } from "./screen/prep-timeline";
import { MORE_DEFAULT_MIN, type StepEvent, type StepEventKind, type StepStatus } from "./timeline/run";
import type { Kitchen } from "./timeline/schedule";
import type { PrepStep } from "./timeline/steps";
import { sayDue, sayLeft, sayNext, sayNow, timelineView, type TimelineInput, type TimelineStepView, type TimelineView } from "./timeline/view";

/** A run under way over its stored steps: everything the voice reads the timeline from. */
export interface PrepVoiceTimeline {
  key: string;
  steps: readonly PrepStep[];
  kitchen: Kitchen;
  boxes: boolean;
  run: PrepRun;
}

export function prepInput(timeline: PrepVoiceTimeline, now: number): TimelineInput {
  return { steps: timeline.steps, kitchen: timeline.kitchen, boxes: timeline.boxes, run: timeline.run, now };
}

/** The one name this prep goes by: the chat card's id and the call's focus. */
export function prepId(run: Pick<PrepRun, "key" | "startedAt">): string {
  return `prep-${run.key}-${run.startedAt}`;
}

/** A run is over when every step is done; the voice has nothing more to do with it. */
export function prepFinished(view: TimelineView): boolean {
  return view.steps.every((s) => s.status === "done");
}

// --- the front's place ----------------------------------------------------------

const STATUS_WORDS: Record<StepStatus, string> = {
  done: "done",
  doing: "doing now",
  waiting: "waiting",
  todo: "not started",
};

const stepLine = (s: TimelineStepView) => `${s.text} | ${s.deviceLabel} | ${STATUS_WORDS[s.status]}`;

/** A numbered step and the waiting-only steps hung under it, in order. */
const withWaits = (view: TimelineView, step: TimelineStepView) => [step, ...view.steps.filter((w) => w.under === step.id)];

/**
 * The steps by the numbers the page shows: one sentence, the device, the
 * state, the waiting-only steps under the step they follow as "after N:".
 * No clock times, no minutes.
 */
export function prepStepList(view: TimelineView): string {
  return view.steps
    .flatMap((s) => {
      if (s.n === null) return [];
      const [, ...waits] = withWaits(view, s);
      return [`${s.n}. ${stepLine(s)}`, ...waits.map((w) => `   after ${s.n}: ${stepLine(w)}`)];
    })
    .join("\n");
}

/** What the front is told about the prep while it runs (docs/671: the place section is the step list). */
export function prepCallPlace(view: TimelineView): string {
  return [
    "They are cooking the batch prep now, with the prep page on screen. The steps, by the numbers the page shows (step | device | state); " +
      "an 'after N:' line is a wait with no number of its own, called by N:",
    prepStepList(view),
    "When they say a step is finished, started, or taking longer, call prep_step with its number; " +
      "give minutes only when they said a number. Then answer with a word or two.",
    "When they ask what is next, what to do now, or how long is left, call prep_say and say nothing yourself.",
    "Never say a clock time, a number of minutes, or which step comes next on your own: the program says those.",
  ].join("\n");
}

// --- the front's two tools ----------------------------------------------------------

export interface PrepToolDeps {
  /** The run under way, read now; null when nothing is running. */
  timeline(): PrepVoiceTimeline | null;
  now(): number;
  /** Write the event into the run (prep-progress.ts recordPrepEvent) and move the card. */
  record(event: StepEvent): Promise<RecordedEvent | null>;
  /** Speak the program's sentence in the call (call-host.ts sayInCall). */
  say(text: string): boolean;
}

const EVENTS: readonly StepEventKind[] = ["done", "started", "more"];
const SAYS = ["next", "now", "left"] as const;
export type PrepSayWhat = (typeof SAYS)[number];

/**
 * The step a number names in the view, or null. A number covers its step and
 * the waits hung under it; the event goes to the first of them not done yet
 * (step 3's hands are done and the pot is letting its pressure out: "3 is done"
 * ends the wait), or to the numbered step itself when all are done.
 */
export function stepByNumber(view: TimelineView, raw: unknown): string | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isInteger(n)) return null;
  const step = view.steps.find((s) => s.n === n);
  if (!step) return null;
  return (withWaits(view, step).find((s) => s.status !== "done") ?? step).id;
}

/** The program's sentence for a question about the schedule. */
export function prepSentence(view: TimelineView, what: PrepSayWhat): string {
  if (what === "next") return sayNext(view);
  if (what === "left") return sayLeft(view);
  return sayNow(view);
}

export function buildPrepStepTool(deps: PrepToolDeps): AgentTool {
  return {
    name: "prep_step",
    label: () => t("meals.tool.prepStep"),
    effect: "write",
    description:
      "Record what the cook said about one step of the prep under way: done ('the onions are chopped'), " +
      "started ('I'm starting the eggs'), or more ('I'm behind, still chopping'). The program moves the rest of " +
      "the timeline. Use the step's number from the list. A wait listed as 'after N:' has no number of its own " +
      "and goes by N: an event on N is recorded on the first of step N and its waits that is not done yet.",
    parameters: Type.Object({
      step: Type.Number({ description: "The step's number in the list (for an 'after N:' wait, N)." }),
      event: Type.String({ description: "done, started or more." }),
      minutes: Type.Optional(Type.Number({ description: "For more: how many more minutes, only if they said a number." })),
    }),
    execute: async (args) => {
      const timeline = deps.timeline();
      if (!timeline) return "No prep is running. Nothing was recorded.";
      const view = timelineView(prepInput(timeline, deps.now()));
      const step = stepByNumber(view, args.step);
      const event = String(args.event ?? "").trim() as StepEventKind;
      if (!step) return "There is no step with that number. Nothing was recorded.";
      if (!EVENTS.includes(event)) return "The event is done, started or more. Nothing was recorded.";
      const said = Number(args.minutes);
      const minutes = event === "more" ? (Number.isFinite(said) && said > 0 ? Math.round(said) : MORE_DEFAULT_MIN) : undefined;
      const out = await deps.record({ step, event, ...(minutes !== undefined ? { minutes } : {}) });
      if (!out) return "The prep could not be updated. Nothing was recorded.";
      if (!out.applied) return `Step ${String(args.step)} is already done. Nothing changed.`;
      return `Step ${String(args.step)}: ${event} recorded; the timeline moved.`;
    },
  };
}

export function buildPrepSayTool(deps: Pick<PrepToolDeps, "timeline" | "now" | "say">): AgentTool {
  return {
    name: "prep_say",
    label: () => t("meals.tool.prepSay"),
    effect: "read",
    description:
      "Have the program tell the cook, from the timeline: next (the next step and when), now (what to do now), " +
      "or left (how long is left). The program speaks the sentence itself; do not say it.",
    parameters: Type.Object({ what: Type.String({ description: "next, now or left." }) }),
    execute: async (args) => {
      const timeline = deps.timeline();
      if (!timeline) return "No prep is running.";
      const what = String(args.what ?? "").trim() as PrepSayWhat;
      if (!SAYS.includes(what)) return "Ask for next, now or left.";
      const sentence = prepSentence(timelineView(prepInput(timeline, deps.now())), what);
      return deps.say(sentence) ? `Said: ${sentence}` : "The call is not open.";
    },
  };
}

export function buildPrepFrontTools(deps: PrepToolDeps): AgentTool[] {
  return [buildPrepStepTool(deps), buildPrepSayTool(deps)];
}

// --- start_prep, in the meals conversation -------------------------------------------

/** What starting the prep came to, as the tool tells the model. */
export type PrepStartOutcome =
  | { kind: "started"; voice: "call" | "joined" | "none" }
  | { kind: "no-prep" }
  | { kind: "no-steps" }
  | { kind: "failed" };

export function startPrepText(out: PrepStartOutcome): string {
  switch (out.kind) {
    case "no-prep":
      return "The plan they have has no prep session. Nothing was started.";
    case "no-steps":
      return "The prep's steps could not be written. Nothing was started; they can try again on the prep page.";
    case "failed":
      return "The start could not be saved. Nothing was started.";
    case "started":
      return out.voice === "none"
        ? "The prep timeline started. Voice is not available on this device, so it runs on the prep page without it."
        : "The prep timeline started and the voice call is on. Say one short line and nothing about the steps: the program reads them.";
  }
}

export function buildStartPrepTool(deps: { startPrep?(): Promise<PrepStartOutcome> }): AgentTool {
  return {
    name: "start_prep",
    label: () => t("meals.tool.startingPrep"),
    effect: "write",
    gate: "instruction",
    description:
      "Only when they say they are starting the batch prep now ('start the prep', 'I'm cooking now'): start the " +
      "prep timeline's clock and open the voice call that walks them through it. A prep already running is kept.",
    parameters: Type.Object({}),
    execute: async () => {
      if (!deps.startPrep) return "Starting the prep is not available here.";
      return startPrepText(await deps.startPrep());
    },
  };
}

// --- timer prompts ----------------------------------------------------------------

/**
 * What to say when the clock moved from `before` to `after` over one run: a
 * waiting step whose minutes ran out (「压力锅到点了，下一步……」), else a hands-on
 * step whose slot came with the hands free. Null when nothing came due.
 */
export function dueSentence(before: TimelineView, after: TimelineView): string | null {
  const was = new Map(before.steps.map((s) => [s.id, s.status]));
  const due = after.steps.filter((s) => s.status === "done" && was.get(s.id) === "waiting");
  if (due.length > 0) {
    const last = due[due.length - 1]!;
    const others = due.slice(0, -1).map((s) => t("meals.timeline.sayDue", { device: s.deviceLabel }));
    return [...others, sayDue(after, last.id)].join(" ");
  }
  const arrived = after.steps.find((s) => s.status === "doing" && s.activeMin > 0 && was.get(s.id) === "todo");
  return arrived && after.current === arrived.id ? sayNow(after) : null;
}

export interface DuePrompterDeps {
  /** The run under way, read at each tick; null stops the prompts. */
  timeline(): PrepVoiceTimeline | null;
  say(text: string): boolean;
  now(): number;
  setTimer(fn: () => void, ms: number): () => void;
}

export interface DuePrompter {
  /** Run from now: what came due before this moment is not said. */
  start(): void;
  stop(): void;
}

/**
 * One timer on the run's whole minutes. Each tick reads the run as it stands
 * and compares it at the last tick's time and at now, so a step moved by an
 * event (a tap, prep_step) is not announced as due: only what the clock did.
 */
export function createDuePrompter(deps: DuePrompterDeps): DuePrompter {
  let cancel: (() => void) | null = null;
  let last = 0;

  const arm = (startedAt: number) => {
    cancel = deps.setTimer(tick, msToNextMinute(deps.now(), startedAt));
  };

  function tick(): void {
    cancel = null;
    const timeline = deps.timeline();
    if (!timeline) return;
    const now = deps.now();
    const before = timelineView(prepInput(timeline, last));
    const after = timelineView(prepInput(timeline, now));
    last = now;
    const sentence = dueSentence(before, after);
    if (sentence) deps.say(sentence);
    if (!prepFinished(after)) arm(timeline.run.startedAt);
  }

  return {
    start() {
      cancel?.();
      cancel = null;
      const timeline = deps.timeline();
      if (!timeline) return;
      last = deps.now();
      arm(timeline.run.startedAt);
    },
    stop() {
      cancel?.();
      cancel = null;
    },
  };
}

// --- the chat card ----------------------------------------------------------------

export function prepCard(timeline: PrepVoiceTimeline): MealsPrepCardData {
  return {
    kind: "meals-prep",
    prepId: prepId(timeline.run),
    key: timeline.key,
    steps: [...timeline.steps],
    burners: timeline.kitchen.burners,
    boxes: timeline.boxes,
    run: timeline.run,
  };
}

/** The card's timeline at `now`: the same view the prep page draws. */
export function prepCardView(card: MealsPrepCardData, now: number): TimelineView {
  return timelineView({ steps: card.steps, kitchen: { burners: card.burners }, boxes: card.boxes, run: card.run, now });
}

// --- the page's voice line ------------------------------------------------------------

/** off: this device has no voice; idle: no call open (after a hang-up, Resume voice); in-call. */
export type PrepVoiceState = "off" | "idle" | "in-call";

export function prepVoiceState(speaks: boolean, open: boolean): PrepVoiceState {
  if (!speaks) return "off";
  return open ? "in-call" : "idle";
}
