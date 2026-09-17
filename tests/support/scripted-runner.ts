// The scripted model and the sub-agent runner over it: the real agent loop, the
// real settling and the real tool execution, with the provider replaced by a
// list of turns. No credentials and no network.
//
// The events each turn streams come from scripted-turn.ts, which holds them to
// the provider grammar the harness's encoder expects (pitfall 306).
//
// Everything is per call — the round counter, the recorded contexts and the
// recorded requests all live in the closure — so two files that each script a
// run cannot see each other's rounds.

import {
  createAssistantMessageEventStream,
  type Api,
  type Context,
  type Model,
} from "@earendil-works/pi-ai";
import { runHarnessTurn, type StreamFn } from "../../src/legion/execute/turn";
import { createSessionFileSystem } from "../../src/platform/app/session-fs";
import { createTurnSettler } from "../../src/legion/subagent/turn";
import type { SubagentTurnFn, SubagentTurnRequest } from "../../src/legion/subagent/types";
import { memoryAppData } from "./memory-appdata";
import { holdHarness } from "../../src/legion/execute/held";
import { toPiMessages } from "../../src/ai/providers";
import type { SendBellTurn } from "../../src/soul";
import { turnEvents, type Turn } from "./scripted-turn";

export const FAUX_MODEL = { id: "m", provider: "faux" } as unknown as Model<Api>;

type Lane = Parameters<typeof runHarnessTurn>[0]["lane"];

export interface ScriptedStreamOptions {
  // What a round past the end of the script streams. A file that never runs off
  // the end can leave it alone; one that does says which it means.
  exhausted?: Turn;
  // Fires as each round is asked for (0-based), which is where a test that
  // cancels an in-flight pass raises its signal.
  beforeRound?: (round: number) => void;
  // Fires with each round's context, for the files that record what was asked
  // rather than reading it back off `contexts` afterwards.
  onContext?: (context: Context) => void;
}

export interface ScriptedStream {
  stream: StreamFn;
  // What each round was asked with, in order.
  contexts: Context[];
  streamed: () => number;
}

export function scriptedStream(
  turns: readonly Turn[],
  options: ScriptedStreamOptions = {},
): ScriptedStream {
  const exhausted = options.exhausted ?? { error: "no scripted turn" };
  const contexts: Context[] = [];
  let round = 0;
  const stream: StreamFn = (_model, context) => {
    const i = round++;
    options.beforeRound?.(i);
    contexts.push(context);
    options.onContext?.(context);
    const s = createAssistantMessageEventStream();
    const events = turnEvents(turns[i] ?? exhausted);
    void (async () => {
      for (const ev of events) {
        await Promise.resolve();
        s.push(ev);
      }
      s.end();
    })();
    return s;
  };
  return { stream, contexts, streamed: () => round };
}

export interface ScriptedRunnerOptions extends ScriptedStreamOptions {
  model?: Model<Api>;
  // The lane the harness runs the turn in, when the caller has one.
  lane?: (request: SubagentTurnRequest) => Lane;
}

export interface ScriptedRunner extends ScriptedStream {
  run: SubagentTurnFn;
  // What each run was asked for, in order.
  requests: SubagentTurnRequest[];
}

export function scriptedSubagentRunner(
  turns: readonly Turn[],
  options: ScriptedRunnerOptions = {},
): ScriptedRunner {
  const scripted = scriptedStream(turns, options);
  const requests: SubagentTurnRequest[] = [];
  const run: SubagentTurnFn = (request) => {
    requests.push(request);
    const settler = createTurnSettler(request.signal, request.onRound);
    void runHarnessTurn({
      stream: scripted.stream,
      fileSystem: createSessionFileSystem(memoryAppData()),
      model: options.model ?? FAUX_MODEL,
      systemPrompt: request.systemPrompt,
      messages: [{ role: "user", content: request.task, timestamp: 0 }],
      tools: request.tools,
      signal: request.signal,
      maxRounds: request.maxRounds,
      purpose: request.purpose,
      ...(options.lane ? { lane: options.lane(request) } : {}),
      ...settler.callbacks,
    });
    return settler.outcome.finally(() => settler.dispose());
  };
  return { ...scripted, run, requests };
}

// The bell answered over the real turn machinery with the provider scripted:
// what is under test at the call sites is the desk the bell is answered over and
// where the reply goes, never how the stream is decoded.
export function scriptedBellSender(
  turns: readonly Turn[],
  options: ScriptedStreamOptions = {},
): SendBellTurn {
  const { stream } = scriptedStream(turns, options);
  const held = holdHarness({
    lane: { name: "soul", sessions: "soul" },
    fileSystem: createSessionFileSystem(memoryAppData()),
  });
  return (turn) =>
    new Promise<string>((resolve, reject) => {
      void runHarnessTurn({
        stream,
        model: FAUX_MODEL,
        systemPrompt: turn.systemPrompt,
        messages: toPiMessages(turn.messages),
        tools: turn.tools,
        maxRounds: 4,
        held,
        onDelta: () => {},
        onToolStart: () => {},
        onToolEnd: () => {},
        onDone: (text) => resolve(text),
        onError: (message) => reject(new Error(message)),
      });
    });
}
