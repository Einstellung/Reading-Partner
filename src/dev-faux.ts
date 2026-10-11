// Verification scaffold for on-device runs. Only a build made with
// VITE_VERIFY_FAUX=1 carries it; every other build folds the guard to false and
// drops the body. While localStorage.__fauxPlan holds a JSON array of
// "text" | "tool" steps, the anthropic provider is a slow faux from startup on,
// so a turn the runtime resumes after a restart streams from it too.
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { providers } from "./ai/providers";
import { AssembledTurns, type AssembledBookTurn } from "./reading/turn/durable-book";

if (import.meta.env.VITE_VERIFY_FAUX === "1") {
  const raw = localStorage.getItem("__fauxPlan");
  if (raw) {
    const plan: string[] = JSON.parse(raw);
    const repeat = Number(localStorage.getItem("__fauxRepeat") || 30);
    const tps = Number(localStorage.getItem("__fauxTps") || 20);
    const tool = JSON.parse(localStorage.getItem("__fauxTool") || '["read_pages",{"from":1,"to":2}]');
    const faux = fauxProvider({
      tokensPerSecond: tps,
      tokenSize: { min: 3, max: 5 },
      models: [{ id: "faux-1", contextWindow: 200000, maxTokens: 4096 }],
    });
    const answer = (n: number) =>
      `FAUX${n} Mr. Bennet's humour is dry and sideways, a way of keeping his wife at arm's length. `.repeat(repeat);
    const steps = [];
    for (let i = 0; i < 40; i++) {
      const kind = plan[i] || "text";
      steps.push(() =>
        kind === "tool"
          ? fauxAssistantMessage(fauxToolCall(tool[0], tool[1]), { stopReason: "toolUse" })
          : fauxAssistantMessage(fauxText(answer(i + 1))),
      );
    }
    faux.setResponses(steps);
    const a = providers.anthropic as unknown as Record<string, unknown>;
    const w = window as unknown as { __fauxCalls: number };
    w.__fauxCalls = 0;
    a.stream = (model: never, context: never, options: never) => (
      w.__fauxCalls++, faux.provider.stream(model, context, options)
    );
    a.streamSimple = (model: never, context: never, options: never) => (
      w.__fauxCalls++, faux.provider.streamSimple(model, context, options)
    );
    // A tool that runs long enough to kill the process inside it. Only tools of
    // turns assembled in this process are slowed; a turn resumed after a
    // restart opens its desk again and runs them at full speed.
    const delay = Number(localStorage.getItem("__fauxToolDelayMs") || 0);
    if (delay > 0) {
      const put = AssembledTurns.prototype.put;
      AssembledTurns.prototype.put = function (key: string, turn: AssembledBookTurn) {
        const tools = turn.tools.map((t) => ({
          ...t,
          execute: async (...args: Parameters<typeof t.execute>) => {
            (window as unknown as { __fauxToolLive: string }).__fauxToolLive = t.name;
            await new Promise((r) => setTimeout(r, delay));
            return t.execute(...args);
          },
        }));
        put.call(this, key, { ...turn, tools });
      };
    }
    console.warn("dev-faux on", raw);
  }
}
