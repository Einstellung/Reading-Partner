// When a first run can be expected (docs/info/88 排队). Runs that touch X are
// claimed only by a desktop that can fetch through a webview; whether one is up
// is read off the claim heartbeat, written hourly (legion/claim). A heartbeat
// in the last two hours means a desktop is on and the first result is about
// half an hour away; otherwise it comes when a computer is on, by tonight at
// the latest.

import { WEBVIEW_FETCH, type DeviceClaim } from "../../legion/claim";
import type { FirstRunEta } from "./cards";

const RECENT_MS = 2 * 60 * 60_000;

export function firstRunEta(claims: readonly DeviceClaim[], now: number): FirstRunEta {
  const up = claims.some(
    (c) => c.claimedAt !== null && c.capabilities.includes(WEBVIEW_FETCH) && now - c.heartbeatAt <= RECENT_MS,
  );
  return up ? "soon" : "tonight";
}
