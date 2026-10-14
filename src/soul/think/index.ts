// The back half of a voice call (docs/companion/136): the `think` kind, the
// call's numbered list of handed-off tasks, and the delegate tool a call mounts.
// What the front may call is in contract.ts.

import { appBox } from "../../box";
import { appRunner } from "../../legion/runner/runner";
import { delegableWorkerKinds } from "../../legion/runner/worker";
import { appData } from "../../platform/app/appdata";
import { answerBellSoon } from "../bell";
import { writeBriefFile } from "../delegate";
import { onVerbatimLanding } from "../delivery";
import { createCallBackend } from "./calls";
import type { CallBackend } from "./contract";

export * from "./contract";
export { createCallBackend, type CallBackendDeps } from "./calls";
export {
  THINK_PROMPT,
  THINK_ROUNDS,
  THINK_TOKEN_CAP,
  registerThinkDesk,
  registerThinkWorker,
  thinkAgent,
  thinkTools,
  thinkWorker,
  type ThinkDesk,
  type ThinkWorkerDeps,
} from "./kind";
export { buildCallDelegateTool, type CallDelegateDeps } from "./tool";

let live: CallBackend | undefined;

/** The app's one call ledger, over this device's runner, box and bell. */
export function callBackend(): CallBackend {
  live ??= createCallBackend({
    delegate: (input) => appRunner().delegate(input),
    cancelRun: (runId) => appRunner().cancel(runId),
    listRuns: () => appRunner().list(),
    watchRuns: (fn) => appRunner().subscribe(fn),
    writeBrief: writeBriefFile,
    readFile: (path) => appData.readText(path),
    box: appBox(),
    onLanding: onVerbatimLanding,
    answerSoon: answerBellSoon,
    kinds: delegableWorkerKinds,
  });
  return live;
}
