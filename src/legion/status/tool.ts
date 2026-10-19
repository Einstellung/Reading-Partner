// background_status: the door's read-only look at background work (docs/55):
// what is queued, running and recently finished, on which device, and how far
// it got, from the run records and the kinds' describers (registry.ts). The
// text is describe.ts's; this file is the tool around it.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../durable/contract";
import { t } from "../../i18n";
import { backgroundStatusText, type StatusInput, type StatusWhich } from "./describe";

export const BACKGROUND_STATUS_TOOL = "background_status";

/** The door's rule, said the same way in the prompt and the description. */
export const BACKGROUND_STATUS_RULE =
  "When the reader asks whether background work came back, finished, started or is still running " +
  "(a topic search's first look or a retry of it, a nightly run, today's briefing, anything handed " +
  "off), call background_status first and answer from it. Conversation search is not a source for " +
  "run state. Say the state, elapsed time and progress it gives; never promise when a run will finish.";

export type BackgroundStatusDeps = Omit<StatusInput, "runs" | "claims" | "deviceId" | "now" | "lastSyncAt" | "syncing"> & {
  deviceId: () => string;
  runs: () => Promise<StatusInput["runs"]>;
  claims: () => Promise<StatusInput["claims"]>;
  now: () => number;
  sync: () => { lastSyncAt: number | null; syncing: boolean };
};

const WHICH = new Set<StatusWhich>(["running", "recent"]);

export function buildBackgroundStatusTool(deps: BackgroundStatusDeps): AgentTool {
  return {
    name: BACKGROUND_STATUS_TOOL,
    replay: "safe",
    effect: "read",
    label: () => t("chat.backgroundStatus.checking"),
    description:
      "How background work is getting on: queued, running and recently finished runs (topic searches, " +
      "briefings, links being taken in, anything handed off), with the state, which device runs it, " +
      "when it started and how long it has run, its last report, a failure's reason, and what the kind " +
      `adds (a topic search's X, arXiv and Hugging Face progress, result and brief issue). ${BACKGROUND_STATUS_RULE}`,
    parameters: Type.Object({
      which: Type.Optional(
        Type.String({ description: "\"running\" for queued and running only; \"recent\" (default) adds what finished in the last 48 hours." }),
      ),
      kind: Type.Optional(Type.String({ description: "Only runs of this kind, e.g. \"topic-search\"." })),
      about: Type.Optional(
        Type.String({ description: "Only runs about this subject: a topic search's id (ts-…) or name. Finished runs of any age are then included." }),
      ),
    }),
    execute: async (args) => {
      const which = typeof args.which === "string" && WHICH.has(args.which as StatusWhich) ? (args.which as StatusWhich) : "recent";
      const kind = typeof args.kind === "string" && args.kind.trim() ? args.kind.trim() : undefined;
      const about = typeof args.about === "string" && args.about.trim() ? args.about.trim() : undefined;
      const [runs, claims] = await Promise.all([deps.runs(), deps.claims().catch(() => [])]);
      return backgroundStatusText(
        { ...deps, runs, claims, deviceId: deps.deviceId(), now: deps.now(), ...deps.sync() },
        { which, ...(kind ? { kind } : {}), ...(about ? { about } : {}) },
      );
    },
  };
}
