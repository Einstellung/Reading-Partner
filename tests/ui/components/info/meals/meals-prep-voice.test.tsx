// The prep's voice on a real DOM (docs/671 时间线与语音): the page with voice,
// without it, in a call and after a hang-up; Resume voice; the hook laying the
// steps and tools on the call; the prep card in the conversation.
// Run: scripts/t.sh tests/ui/components/info/meals/meals-prep-voice.test.tsx

import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as os from "@tauri-apps/plugin-os";
import { getLocale, setLocale, type Locale } from "../../../../../src/i18n";
import type { MealsState, PrepRun } from "../../../../../src/info/meals/plan/types";
import { prepCard } from "../../../../../src/info/meals/prep-voice";
import type { PrepStepsStatus } from "../../../../../src/info/meals/screen/prep-timeline";
import { resetVoiceCapability } from "../../../../../src/platform/app/voice-capability";
import { callExtra, openCall, registerCallHost, resetCallHost, type CallBuilder } from "../../../../../src/soul/voice/live/call-host";
import { useDom } from "../../../../support/dom";
import { plannerState, START } from "../../../../info/meals/screen/batch-cook-fixture";
import { at, CHILI_STEPS, runOnStep2, STEPS_KEY } from "../../../../info/meals/screen/prep-timeline-fixture";

const { act, cleanup, fireEvent, render } = await useDom();
const { MealsPrep } = await import("../../../../../src/ui/components/info/meals/MealsPrep");
const { MealsPrepCard } = await import("../../../../../src/ui/components/info/MealsPrepCard");
const { usePrepVoice, requestPrepVoice } = await import("../../../../../src/ui/components/info/meals/use-prep-voice");

let before: Locale;
let host = "ios";
beforeEach(() => {
  before = getLocale();
  setLocale("en");
  host = "ios";
  resetVoiceCapability();
  spyOn(os, "platform").mockImplementation((() => host) as typeof os.platform);
});
afterEach(() => {
  cleanup();
  setLocale(before);
  resetCallHost();
  resetVoiceCapability();
});

const READY: PrepStepsStatus = { kind: "ready", key: STEPS_KEY, at: 1, steps: CHILI_STEPS };

function withRun(run: PrepRun | null): MealsState {
  const s = plannerState();
  const plan = s.plan!;
  return { ...s, plan: { ...plan, planner: { ...plan.planner!, ...(run ? { prepRun: run } : {}) } } };
}

function page(run: PrepRun | null, voice: "off" | "idle" | "in-call") {
  const calls: string[] = [];
  const r = render(
    <MealsPrep
      state={withRun(run)}
      photos={{}}
      today={START}
      session="s1"
      onBack={() => {}}
      onAsk={() => {}}
      onDone={() => {}}
      steps={READY}
      onStart={async () => {
        calls.push("start");
        return true;
      }}
      onStep={() => {}}
      clock={() => at(12)}
      voice={voice}
      onResumeVoice={() => calls.push("resume")}
    />,
  );
  return { ...r, calls };
}

const button = (c: HTMLElement, text: string) => [...c.querySelectorAll("button")].find((b) => b.textContent === text) ?? null;

test("before the start, Start prep whatever the voice", () => {
  for (const voice of ["off", "idle"] as const) {
    const { container } = page(null, voice);
    expect(button(container, "Start prep")).not.toBeNull();
    expect(button(container, "Resume voice")).toBeNull();
    cleanup();
  }
});

test("in a call: neither Start nor Resume voice", () => {
  const { container } = page(runOnStep2(), "in-call");
  expect(button(container, "Start prep")).toBeNull();
  expect(button(container, "Resume voice")).toBeNull();
  expect(container.textContent).not.toContain("Voice isn't available");
});

test("hung up mid-prep: Resume voice in Start's place reopens the call and does not restart the run", () => {
  const { container, calls } = page(runOnStep2(), "idle");
  const resume = button(container, "Resume voice")!;
  expect(resume).not.toBeNull();
  fireEvent.click(resume);
  expect(calls).toEqual(["resume"]);
});

test("no voice on this device: the run goes on and one line says so", () => {
  const { container } = page(runOnStep2(), "off");
  expect(button(container, "Resume voice")).toBeNull();
  expect(container.textContent).toContain("Voice isn't available on this device, so the timeline runs without it.");
});

function Probe(props: { run: PrepRun | null; done?: boolean; seen: (state: string, request: () => string) => void }) {
  const voice = usePrepVoice({
    steps: { key: STEPS_KEY, steps: CHILI_STEPS, kitchen: { burners: 2 }, boxes: true },
    run: props.run,
    done: props.done ?? false,
    ports: () => ({}) as never,
    clock: () => at(12),
  });
  props.seen(voice.state, voice.request);
  return null;
}

test("while a run is under way the steps and the two tools ride on the call; done or unmounted, they go", () => {
  let state = "";
  const r = render(<Probe run={runOnStep2()} seen={(s) => (state = s)} />);
  expect(state).toBe("idle");
  const extra = callExtra()!;
  expect(extra.place()).toContain("2. Brown the chicken in the big pot | Stove | doing now");
  expect(extra.tools().map((t) => t.name)).toEqual(["prep_step", "prep_say"]);
  r.rerender(<Probe run={runOnStep2()} done seen={(s) => (state = s)} />);
  expect(callExtra()).toBeNull();
  r.rerender(<Probe run={runOnStep2()} seen={(s) => (state = s)} />);
  expect(callExtra()).not.toBeNull();
  r.unmount();
  expect(callExtra()).toBeNull();
});

test("before the start nothing rides on the call", () => {
  render(<Probe run={null} seen={() => {}} />);
  expect(callExtra()).toBeNull();
});

test("the page sees the call open and close; asking for the voice starts the meals call, joins an open one", () => {
  const states: string[] = [];
  const asked: (CallBuilder | undefined)[] = [];
  registerCallHost({ start: (b) => void asked.push(b) });
  render(<Probe run={runOnStep2()} seen={(s) => states.push(s)} />);
  expect(requestPrepVoice()).toBe("call");
  expect(asked).toHaveLength(1);
  expect(asked[0]).toBeFunction();
  let close: () => void = () => {};
  act(() => {
    close = openCall(() => {});
  });
  expect(states[states.length - 1]).toBe("in-call");
  expect(requestPrepVoice()).toBe("joined");
  expect(asked).toHaveLength(1);
  act(() => close());
  expect(states[states.length - 1]).toBe("idle");
});

test("a device with no voice asks for no call", () => {
  host = "linux";
  const asked: unknown[] = [];
  registerCallHost({ start: (b) => void asked.push(b) });
  let state = "";
  render(<Probe run={runOnStep2()} seen={(s) => (state = s)} />);
  expect(state).toBe("off");
  expect(requestPrepVoice()).toBe("none");
  expect(asked).toEqual([]);
});

test("the prep card: the current step marked, done steps faded, clock times and the end", () => {
  const card = prepCard({ key: STEPS_KEY, steps: CHILI_STEPS, kitchen: { burners: 2 }, boxes: true, run: runOnStep2() });
  const { container } = render(<MealsPrepCard payload={card} dispatch={() => {}} surface="bubble" />);
  const rows = [...container.querySelectorAll("li")];
  expect(rows).toHaveLength(5);
  expect(container.textContent).toContain("Batch cook");
  expect(container.textContent).toMatch(/Ends /);
  const done = rows.find((li) => li.textContent?.includes("Chop the onion"))!;
  expect(done.dataset.status).toBe("done");
  expect(done.className).toContain("opacity-45");
  const current = rows.find((li) => li.textContent?.includes("Brown the chicken"))!;
  expect(current.className).toContain("bg-secondary-faint");
});
