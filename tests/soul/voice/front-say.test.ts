// The program's own sentences in a call (docs/info/671 时间线与语音): `say` speaks
// them through the read-out path with no model turn, as soon as nobody is
// talking; a screen's tools and place lines ride on every turn while attached.

import { expect, test } from "bun:test";
import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../../src/legion/durable/contract";
import type { CallBack } from "../../../src/soul/voice/front/backend";
import { createCascadeFront } from "../../../src/soul/voice/front/cascade";
import type { FrontModelRequest } from "../../../src/soul/voice/front/model";

function setup(script: (req: FrontModelRequest) => void, extra: { tools?: AgentTool[]; attached?: string | null } = {}) {
  const backend: CallBack = {
    delegateTool: () => ({ name: "delegate", label: () => "", effect: "write", description: "", parameters: Type.Object({}), execute: async () => "" }),
    cancel: async () => ({ ok: true }),
    tasks: () => [],
    text: async () => null,
    told: async () => true,
    subscribe: () => () => {},
  };
  const requests: FrontModelRequest[] = [];
  const written: { key: string; text: string }[] = [];
  const front = createCascadeFront({
    model: async (req) => {
      requests.push(req);
      script(req);
    },
    backend,
    place: () => "In the meals conversation.",
    attached: () => extra.attached ?? null,
    extraTools: () => extra.tools ?? [],
    write: (l) => written.push({ key: l.key, text: l.text }),
    filler: { play: async () => false },
    locale: "en-US",
    marks: () => {},
    onShow: () => {},
    now: () => 0,
    setTimer: () => () => {},
  });
  const programs: number[] = [];
  front.bind({
    program: async (turn) => {
      programs.push(turn);
      return true;
    },
  });
  return { front, requests, written, programs };
}

async function ask(front: ReturnType<typeof setup>["front"], turn: number, text = "") {
  const deltas: string[] = [];
  await front.model.ask({ turn, text, signal: new AbortController().signal, onDelta: (c) => deltas.push(c), onActivity: () => {} });
  return deltas.join("");
}

test("say waits for the floor, then speaks the sentence as it is without asking the model", async () => {
  const h = setup(() => {});
  h.front.observe({ type: "orb", phase: "thinking" });
  h.front.say("The pressure cooker is done. Now: drain the beans");
  expect(h.programs).toEqual([]);
  h.front.event({ kind: "speech-duck", turn: 1 } as never);
  h.front.observe({ type: "orb", phase: "listening" });
  // The reader is talking: still nothing.
  expect(h.programs).toEqual([]);
  h.front.event({ kind: "speech-resume", turn: 1 } as never);
  // Nobody talking: at once, no 2 s gap.
  expect(h.programs).toEqual([-1]);
  expect(await ask(h.front, -1)).toBe("The pressure cooker is done. Now: drain the beans");
  expect(h.requests).toHaveLength(0);
  // Written to the call's conversation like any line the companion says.
  h.front.transcript.record({ role: "ai", turn: -1, text: "The pressure cooker is done. Now: drain the beans", interrupted: false });
  expect(h.written).toEqual([{ key: "-1:ai", text: "The pressure cooker is done. Now: drain the beans" }]);
});

test("a screen's tools are offered on top of the four and run when called; its lines join the place", async () => {
  const ran: unknown[] = [];
  const tool: AgentTool = {
    name: "prep_say",
    label: () => "",
    effect: "read",
    description: "",
    parameters: Type.Object({}),
    execute: async (args) => {
      ran.push(args);
      return "Said.";
    },
  };
  const h = setup((req) => req.onToolCall({ name: "prep_say", args: { what: "next" } }), {
    tools: [tool],
    attached: "1. Chop the onion | Counter | doing now",
  });
  await ask(h.front, 1, "what's next");
  expect(h.requests[0]!.tools.map((t) => t.name)).toEqual(["delegate", "cancel", "read_out", "show", "prep_say"]);
  expect(h.requests[0]!.system).toContain("In the meals conversation.\n1. Chop the onion | Counter | doing now");
  expect(ran).toEqual([{ what: "next" }]);
});

test("with nothing attached the call offers the four tools and the place alone", async () => {
  const h = setup(() => {});
  await ask(h.front, 1, "hello");
  expect(h.requests[0]!.tools.map((t) => t.name)).toEqual(["delegate", "cancel", "read_out", "show"]);
  expect(h.requests[0]!.system).toContain("Where this call is held:\nIn the meals conversation.\n\nThe numbered list");
});
