// What info keeps on a device's claim, and the file readers leave for the
// collector (docs/36).
//
// legion/claim/<deviceId>.json  a device saying who it is and what it can do,
//                               with info's own fields on this device's copy:
//                               how its last run went and what it has already
//                               been asked for.
// info-ask-<deviceId>.json      a reader asking for a briefing it cannot build
//                               itself.
//
// One writer each and no merge: a device only ever writes the file named after
// itself, so two devices writing at the same moment produce two files, not a
// conflict. The strategy for both is opaque (platform/sync/merge/contract.ts),
// which is what a crossing pair should leave behind — a copy nobody reads.
//
// Two collectors is the thing to prevent: the same day's briefing generated
// twice, paid for twice, and published twice with different contents. The
// election that stops it is legion's (src/legion/claim), a pure function of the
// claims on disk and the clock; what is left here is the collector's kind, the
// fields info hangs off the claim, and what a reader is told about them.

import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { electFor, type DeviceClaim } from "../../legion/claim";
import type { PullMatcher } from "../../platform/sync/pull-routes";
import type { SourceHealth } from "../sources/engine";

// The run kind collecting is: one machine gathers the day's sources and builds
// the briefing, the others stand by.
//
// It needs nothing of the machine. Every device that the reader left background
// collection turned on for is a candidate, which is exactly who was eligible
// before capabilities existed — a phone that cannot render a page in a hidden
// webview collects fewer bodies, it does not decline to collect.
//
// What the kind needs of a machine is declared where its worker is
// (info/program/collect-worker.ts), in the same call: a device that can run the
// kind and a device that may are never separately true (docs/55). Only the name
// is here, because this is where a collector's claim is read.
export const COLLECT_KIND = "collect";

// A heartbeat older than this means the collector is not running. Said to the
// reader ("your collector was last online at…") rather than acted on: two hours
// of silence is a closed laptop, not a machine that has given up its claim. The
// threshold it has given up at is legion's FORFEIT_MS.
export const COLLECTOR_OFFLINE_MS = 2 * 60 * 60_000;

// An ask older than this is not executed. A regenerate the reader asked for
// before lunch is not one they still want in the evening.
export const ASK_EXPIRY_MS = 6 * 60 * 60_000;

export type AskScope = "retriage" | "full";

const ASK_PREFIX = "info-ask-";
const JSON_SUFFIX = ".json";

export function askFile(deviceId: string): string {
  return `${ASK_PREFIX}${deviceId}${JSON_SUFFIX}`;
}

// A reader asking for a briefing. The collector runs it when the file lands,
// not at its next wake — the reader is waiting for it.
export const ASK_PULL_ROUTE: PullMatcher = {
  id: "ask",
  matches: (path) => path.startsWith(ASK_PREFIX) && path.endsWith(JSON_SUFFIX),
};

// What a collector says about itself, on top of what every device says
// (legion/claim). Everything here is display or info's own bookkeeping; the
// election reads none of it.
export interface CollectorClaim extends DeviceClaim {
  lastRunAt: number | null;
  lastBriefingDate: string | null;
  // Why the last run stopped short, in the collector's own words. Nobody is
  // watching the collector's screen, so this is how the reason reaches the
  // person holding the phone.
  halt: string | null;
  // Per source, when it last succeeded and what it last said — the contents of
  // this machine's info-source-health.json, which does not itself travel.
  sources: Record<string, SourceHealth>;
  // Per site that needs one, whether this machine currently has a session. The
  // cookie stays here; only the yes-or-no travels.
  sites: Record<string, boolean>;
  // The newest ask this collector has executed, so the same request is not run
  // twice when it is pulled again.
  lastAskAt: number | null;
}

// What a reader leaves for the collector. Written whole every time; the previous
// contents are not consulted, since a newer ask supersedes an older one.
export interface AskRecord {
  deviceId: string;
  askedAt: number;
  scope: AskScope;
  // Something the user said that should travel with the request. Nothing writes
  // it yet. docs/36 has the companion put "I want to subscribe to X" here, but
  // an ask always costs a collection run and a subscription request should not
  // buy one — and the conversation itself already travels (threads-info-<date>
  // is in the sync range), so the sentence is waiting on the collector's screen
  // in the thread the user typed it into. Kept in the shape because a request
  // that does want words attached will want this field and not a second file.
  note?: string;
}

// --- what a reader is told ---------------------------------------------------

// What a reader should say about the collectors it can see. The elected one when
// it is alive; otherwise whichever machine reported most recently, so the
// sentence is "last online at 08:14" rather than nothing at all. `online` is the
// two-hour threshold — a claim can be the elected one and still be asleep.
export interface CollectorReport {
  collector: CollectorClaim | null;
  online: boolean;
}

export function collectorReport(claims: CollectorClaim[], now: number): CollectorReport {
  const winner = electFor(COLLECT_KIND, claims, now);
  const elected = claims.find((c) => c.deviceId === winner) ?? null;
  if (elected && now - elected.heartbeatAt <= COLLECTOR_OFFLINE_MS) {
    return { collector: elected, online: true };
  }
  let latest: CollectorClaim | null = elected;
  for (const claim of claims) {
    if (!latest || claim.heartbeatAt > latest.heartbeatAt) latest = claim;
  }
  return { collector: latest, online: false };
}

// --- asks -------------------------------------------------------------------

// The one ask to act on, out of everything on disk. Expired ones are dropped,
// so are ones this collector has already run; of what is left the newest is the
// request (it carries the note), and the scope is the widest anyone asked for —
// two readers asking at once get one run that satisfies both, and a re-triage is
// contained in a full regeneration anyway.
export function chooseAsk(
  asks: AskRecord[],
  lastAskAt: number | null,
  now: number,
): AskRecord | null {
  const live = asks.filter(
    (a) =>
      Number.isFinite(a.askedAt) &&
      now - a.askedAt <= ASK_EXPIRY_MS &&
      a.askedAt <= now &&
      (lastAskAt === null || a.askedAt > lastAskAt),
  );
  if (live.length === 0) return null;
  let newest = live[0];
  let scope: AskScope = "retriage";
  for (const ask of live) {
    if (ask.askedAt > newest.askedAt) newest = ask;
    if (ask.scope === "full") scope = "full";
  }
  return { ...newest, scope };
}

// --- files ------------------------------------------------------------------

function isAsk(value: unknown): value is AskRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<AskRecord>;
  return (
    typeof v.deviceId === "string" &&
    typeof v.askedAt === "number" &&
    (v.scope === "full" || v.scope === "retriage")
  );
}

export async function readAsks(): Promise<AskRecord[]> {
  let names: string[];
  try {
    const entries = await appData.readDir("");
    names = entries
      .filter((e) => e.isFile && e.name.startsWith(ASK_PREFIX) && e.name.endsWith(JSON_SUFFIX))
      .map((e) => e.name);
  } catch {
    return [];
  }
  const out: AskRecord[] = [];
  for (const name of names) {
    try {
      const parsed: unknown = JSON.parse(await appData.readText(name));
      if (isAsk(parsed)) out.push(parsed);
    } catch {
      // A half-written or hand-edited file is one reader's request missing, not
      // a reason to stop reading the others.
    }
  }
  return out;
}

export function writeAsk(ask: AskRecord): Promise<void> {
  return writeTextAtomic(askFile(ask.deviceId), JSON.stringify(ask, null, 2));
}
