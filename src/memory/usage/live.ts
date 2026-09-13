// Live wiring of the per-device logs in this directory: this device's identity,
// and the AppData files they append to.
//
// Here rather than in memory/live, where it started, because the send path
// writes the model-call log and src/ai may not import memory/live — that
// directory calls ai/model-call, and the edge back would close a cycle
// (tests/layering.test.ts). Nothing in this directory imports anything but
// platform.

import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { currentDeviceId } from "../../platform/app/device";
import type { UsageIo } from "./log";
import { createModelCallLog } from "./model-calls";

// The exists() probe keeps "not there yet" apart from "there and would not
// open". Every append rewrites the whole log, so the two cannot share an
// answer — see UsageIo.read.
export const usageIo: UsageIo = {
  async read(path) {
    if (!(await appData.exists(path))) return null;
    return await appData.readText(path);
  },
  write(path, content) {
    return writeTextAtomic(path, content);
  },
  deviceId: currentDeviceId,
  now: Date.now,
};

export const logModelCall = createModelCallLog(usageIo).logModelCall;
