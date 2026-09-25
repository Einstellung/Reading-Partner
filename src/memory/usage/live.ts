// Live wiring of the per-device logs in this directory: this device's identity,
// and the AppData files they append to.
//
// Here rather than in memory/live, where it started, because the send path
// writes the model-call log and src/ai may not import memory/live — that
// directory calls ai/model-call, and the edge back would close a cycle
// (tests/layering.test.ts). Nothing in this directory imports anything but
// platform.

import { appTextFileIo } from "../../platform/app/text-file-io";
import { currentDeviceId } from "../../platform/app/device";
import type { UsageIo } from "./log";
import { createModelCallLog } from "./model-calls";

export const usageIo: UsageIo = {
  ...appTextFileIo(),
  deviceId: currentDeviceId,
  now: Date.now,
};

export const logModelCall = createModelCallLog(usageIo).logModelCall;
