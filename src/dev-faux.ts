// Verification scaffold for on-device runs. Only a build made with
// VITE_VERIFY_FAUX=1 carries it; every other build folds the guard to false and
// drops the body. While localStorage.__fauxPlan holds a JSON array of
// steps — "text", "tool" (the __fauxTool call) or a [name, args] call of
// its own — the anthropic provider is a slow faux from startup on,
// so a turn the runtime resumes after a restart streams from it too.
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { providers } from "./ai/providers";
import { AssembledTurns, type AssembledBookTurn } from "./reading/turn/durable-book";
import { infoAssemblies } from "./info/briefer/info-durable";
import { retellAssemblies } from "./reading/retell/retell-durable";
import { coachAssemblies } from "./reading/rehearsal/coach-durable";

if (import.meta.env.VITE_VERIFY_FAUX === "1") {
  const raw = localStorage.getItem("__fauxPlan");
  if (raw) {
    const plan: (string | [string, Record<string, unknown>])[] = JSON.parse(raw);
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
      const call = Array.isArray(kind) ? kind : kind === "tool" ? tool : null;
      steps.push(() =>
        call
          ? fauxAssistantMessage(fauxToolCall(call[0], call[1]), { stopReason: "toolUse" })
          : fauxAssistantMessage(fauxText(answer(i + 1))),
      );
    }
    faux.setResponses(steps);
    const a = providers.anthropic as unknown as Record<string, unknown>;
    const w = window as unknown as { __fauxCalls: number; __fauxContexts: [string, string][][] };
    w.__fauxCalls = 0;
    // What each call was sent, role and the head of its text, so a run can see
    // the history a resumed turn read back.
    w.__fauxContexts = [];
    const seen = (context: { messages?: { role: string; content: unknown }[] }) => {
      w.__fauxCalls++;
      w.__fauxContexts.push(
        (context.messages ?? []).map((m) => [
          m.role,
          (typeof m.content === "string"
            ? m.content
            : Array.isArray(m.content)
              ? m.content.map((c: { text?: string; name?: string }) => c.text ?? c.name ?? "").join(" ")
              : ""
          ).slice(0, 60),
        ]),
      );
    };
    a.stream = (model: never, context: never, options: never) => (
      seen(context), faux.provider.stream(model, context, options)
    );
    a.streamSimple = (model: never, context: never, options: never) => (
      seen(context), faux.provider.streamSimple(model, context, options)
    );
    // A tool that runs long enough to kill the process inside it. Only tools of
    // turns assembled in this process are slowed; a turn resumed after a
    // restart opens its desk again and runs them at full speed.
    const delay = Number(localStorage.getItem("__fauxToolDelayMs") || 0);
    if (delay > 0) {
      const slow = <T extends AssembledBookTurn["tools"][number]>(t: T): T => ({
        ...t,
        execute: async (...args: Parameters<T["execute"]>) => {
          (window as unknown as { __fauxToolLive: string }).__fauxToolLive = t.name;
          await new Promise((r) => setTimeout(r, delay));
          return (t.execute as (...a: Parameters<T["execute"]>) => ReturnType<T["execute"]>)(...args);
        },
      });
      const put = AssembledTurns.prototype.put;
      AssembledTurns.prototype.put = function (key: string, turn: AssembledBookTurn) {
        put.call(this, key, { ...turn, tools: turn.tools.map(slow) });
      };
      // The info, meals, retell and coach turns keep their desks in plain maps.
      for (const map of [infoAssemblies, retellAssemblies, coachAssemblies] as Map<string, AssembledBookTurn>[]) {
        const set = map.set.bind(map);
        map.set = (key, turn) => set(key, { ...turn, tools: turn.tools.map(slow) });
      }
    }
    console.warn("dev-faux on", raw);
  }
}
