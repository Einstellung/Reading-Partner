// Child process of crash.test.ts: start a reading turn on the durable runtime
// and print ARMED at the moment the parent should SIGKILL it.
// Usage: bun crash-child.ts <mode> <root>
//   mid-text     a slow answer, armed once 200 characters are committed
//   unsafe-tool  armed inside `note` (not replay-safe)
//   safe-tool    armed inside `lookup` (replay-safe)
//   land         armed inside the lander, after the file is written

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { startTurn, textOf } from "../../../src/legion/durable/turn";
import { openTestRuntime, readerTurn } from "./support/runtime";

export const CRASH_ANSWER = "潮汐是月球和太阳引力共同作用的结果，".repeat(40);

const [mode, root] = process.argv.slice(2);
const arm = (detail = "") => process.stdout.write(`ARMED ${detail}\n`);
const forever = () => new Promise<never>(() => {});
const tool = (name: string, args: Record<string, string>) =>
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });

const t = await openTestRuntime({
  root: root!,
  tokensPerSecond: mode === "mid-text" ? 70 : 5000,
  responses:
    mode === "mid-text"
      ? [fauxAssistantMessage(fauxText(CRASH_ANSWER))]
      : mode === "unsafe-tool"
        ? [tool("note", { text: "tides" })]
        : mode === "safe-tool"
          ? [tool("lookup", { query: "tides" })]
          : [fauxAssistantMessage(fauxText("Short answer."))],
  desk: {
    note: async () => (arm(), forever()),
    lookup: async () => (arm(), forever()),
  },
  ...(mode === "land" ? { afterLand: async () => (arm(), forever()) } : {}),
});
const turn = await startTurn(t.runtime, readerTurn(t, "Explain the tides.", 1000), ctx);
if (mode === "mid-text") {
  let fired = false;
  (await turn.conversation.viewState(ctx)).subscribe((value) => {
    const live = value.docs["pi.live"] as { generation?: { message?: unknown } } | undefined;
    const partial = textOf(live?.generation?.message);
    if (!fired && partial.length >= 200) {
      fired = true;
      arm(String(partial.length));
    }
  });
}
await forever();
