// run_code in real WebKitGTK (docs/soul/686): the engine fetched from
// /quickjs/quickjs.wasm, programs run in the worker Vite emitted, and the page
// left running while a program spins. Leaves its checks in window.__result.

import { Type } from "@earendil-works/pi-ai";
import { buildCodemodeTool } from "../../src/legion/codemode";
import type { AgentTool } from "../../src/legion/durable/contract";

declare const WORKER_URL: string;

let wrote = 0;
const read: AgentTool = {
  name: "list_meals",
  label: () => "",
  effect: "read",
  description: "",
  parameters: Type.Object({}),
  execute: async () => JSON.stringify([{ kcal: 400, eaten: true }, { kcal: 300, eaten: false }, { kcal: 250, eaten: true }]),
};
const write: AgentTool = {
  name: "save_meal",
  label: () => "",
  effect: "write",
  description: "",
  parameters: Type.Object({}),
  execute: async () => {
    wrote++;
    return { text: "", receipt: null };
  },
};

async function attempt(run: () => Promise<unknown>): Promise<string> {
  try {
    return String(await run());
  } catch (e) {
    return `THREW ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function liveness(run: () => Promise<string>) {
  let ticks = 0;
  const id = setInterval(() => ticks++, 20);
  const started = performance.now();
  const out = await run();
  clearInterval(id);
  return { out, ticks, ms: Math.round(performance.now() - started) };
}

async function main() {
  const checks: { name: string; ok: boolean; detail: unknown }[] = [];
  const spawn = () => new Worker(WORKER_URL, { type: "module" });
  const worker = buildCodemodeTool([read, write], { runner: "worker", spawn });
  const sum = "return JSON.parse(await tools.list_meals({})).filter((m) => m.eaten).reduce((s, m) => s + m.kcal, 0);";

  const computed = await attempt(() => worker.execute({ code: sum }));
  checks.push({ name: "worker: reads and computes", ok: computed === "Returned: 650", detail: computed });

  const hidden = await attempt(() => worker.execute({ code: "await tools.save_meal({});" }));
  checks.push({ name: "worker: write tool absent", ok: hidden.includes("does not exist") && wrote === 0, detail: hidden });

  const host = await attempt(() => worker.execute({ code: "return [typeof fetch, typeof XMLHttpRequest, typeof importScripts, typeof WebAssembly].join(',');" }));
  checks.push({ name: "worker: no network or host", ok: host === "Returned: undefined,undefined,undefined,undefined", detail: host });

  const error = await attempt(() => worker.execute({ code: "const x = null;\nreturn x.y;" }));
  checks.push({ name: "worker: script error with line", ok: error.includes("(script)") && error.includes("codemode.js:2"), detail: error });

  const spinTool = buildCodemodeTool([read], { runner: "worker", spawn, limits: { timeoutMs: 1500, interruptBudget: 1e12 } });
  const spin = await liveness(() => attempt(() => spinTool.execute({ code: "while (true) {}" })));
  checks.push({ name: "worker: a spinning program leaves the page live and ends on its deadline", ok: spin.out.includes("(timeout)") && spin.ticks > 30, detail: spin });

  const inline = buildCodemodeTool([read], { runner: "inline" });
  const inlineSum = await attempt(() => inline.execute({ code: sum }));
  checks.push({ name: "inline: reads and computes", ok: inlineSum === "Returned: 650", detail: inlineSum });

  const budget = await liveness(() => attempt(() => inline.execute({ code: "while (true) {}" })));
  // Informational: how long the default interrupt budget holds this thread.
  checks.push({ name: "inline: default budget ends a spin (blocks the page meanwhile)", ok: budget.out.includes("(timeout)"), detail: budget });

  (window as unknown as { __result: string }).__result = JSON.stringify({ checks });
}

main().catch((e) => {
  (window as unknown as { __result: string }).__result = JSON.stringify({ checks: [], error: String(e?.stack ?? e) });
});
