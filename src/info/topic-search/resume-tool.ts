// resume_x_reading (docs/info/88 「停手」): a second challenge or rate limit in
// a row pauses X reading on the device that met it until the reader says to
// read X again. The halt record is this device's own (run-state.ts), so the
// tool lifts a pause only where the conversation runs; the text says so when
// there is none here.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../legion/durable/contract";
import { t } from "../../i18n";
import type { XHaltRecord } from "./halt";

/** What resuming did: whether a pause was lifted, and the halt left on this device. */
export interface XResume {
  lifted: boolean;
  halt: XHaltRecord | null;
}

export interface ResumeToolDeps {
  resume(): Promise<XResume>;
}

function notLifted(halt: XHaltRecord | null): string {
  if (!halt) {
    return (
      "X reading is not paused on this device, so nothing changed. A pause is kept on the computer " +
      "that read X; if it was paused there, the reader says this at the door on that computer."
    );
  }
  if (halt.kind === "signed-out") {
    return (
      "X signed this device out and no check since found it signed in; resuming does not change " +
      "that. The reader signs in to X in Settings > Accounts. After that, X is read by the nightly run " +
      "from 01:00, or now by retry_topic_search_first_run for what a first run missed."
    );
  }
  return (
    `X reading is not paused: after a ${halt.kind} only the next night is skipped, and the one ` +
    "after it reads X again by itself. Nothing changed."
  );
}

export function buildResumeXReadingTool(deps: ResumeToolDeps): AgentTool {
  return {
    name: "resume_x_reading",
    label: () => t("info.tool.resumingXReading"),
    effect: "write",
    gate: "instruction",
    description:
      "Read X again for topic searches after it was paused (X asked for verification or limited " +
      "requests twice in a row). Only when the reader says to resume; never on your own initiative.",
    parameters: Type.Object({}),
    execute: async () => {
      const result = await deps.resume();
      if (!result.lifted) return { text: notLifted(result.halt), receipt: null };
      return {
        text: "X reading is resumed on this device; the next night reads X again. Tell the reader in one line.",
        receipt: { label: t("info.tool.resumedXReading"), summary: "x.com" },
      };
    },
  };
}
