// Child process of background-crash.test.ts: start a background run on the
// durable runtime and print ARMED where the parent should SIGKILL it.
// Usage: bun background-crash-child.ts <mode> <root>
//   in-tool   armed inside the run's tool
//   mid-text  a slow answer, armed once 200 characters are committed

import { Type } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { runBackgroundTurnOn } from "../../../src/legion/durable/background";
import { openTestRuntime } from "./support/runtime";

const [mode, root] = process.argv.slice(2);
const arm = () => process.stdout.write("ARMED\n");
const forever = () => new Promise<never>(() => {});

const t = await openTestRuntime({
  root: root!,
  tokensPerSecond: mode === "mid-text" ? 70 : 5000,
  responses:
    mode === "mid-text"
      ? [fauxAssistantMessage(fauxText("潮汐是月球和太阳引力共同作用的结果，".repeat(40)))]
      : [fauxAssistantMessage([fauxToolCall("observe", { row: 1 })], { stopReason: "toolUse" })],
});
let fired = false;
void runBackgroundTurnOn(
  { runtime: t.runtime },
  {
    name: "distill",
    systemPrompt: "You distill.",
    task: "Distill this.",
    tools: [
      {
        name: "observe",
        description: "Write one observation.",
        parameters: Type.Object({ row: Type.Number() }),
        label: () => "Writing",
        effect: "write",
        execute: async () => (arm(), forever()),
      },
    ],
    maxRounds: 4,
    purpose: "chat",
    model: { providerId: "faux", modelId: "faux-1" },
    onProgress: (chars) => {
      if (mode === "mid-text" && !fired && chars >= 200) {
        fired = true;
        arm();
      }
    },
  },
);
await forever();
