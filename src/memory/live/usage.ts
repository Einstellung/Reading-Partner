// Live wiring of the memory usage log: this device's identity, and the AppData
// file it appends to.

import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { currentDeviceId } from "../../platform/app/device";
import { createUsageLog, type UsageIo } from "../usage/log";

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

export const logUsage = createUsageLog(usageIo).logUsage;
