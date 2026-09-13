// Live binding of the memory usage log, over the io the logs in memory/usage
// share (memory/usage/live.ts).

import { createUsageLog } from "../usage/log";
import { usageIo } from "../usage/live";

export { usageIo };

export const logUsage = createUsageLog(usageIo).logUsage;
