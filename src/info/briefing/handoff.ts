// The two files devices leave for each other (docs/36).
//
// info-collector-<deviceId>.json  a collector saying who it is, when it was last
//                                 alive, and how its last run went.
// info-ask-<deviceId>.json        a reader asking for a briefing it cannot build
//                                 itself.
//
// One writer each and no merge: a device only ever writes the file named after
// itself, so two devices writing at the same moment produce two files, not a
// conflict. The strategy for both is opaque (platform/sync/merge/contract.ts),
// which is what a crossing pair should leave behind — a copy nobody reads.
//
// Two collectors is the thing to prevent: the same day's briefing generated
// twice, paid for twice, and published twice with different contents. The
// election below is how they agree without talking. It is a pure function of the
// files on disk and the clock, so every device computes the same answer for
// itself, and a device that loses simply stands by.
//
// claimedAt is reset on every process start, so the winner is the machine that
// has been up longest without interruption — the one a 24-hour collector is
// meant to be. A machine that lost and comes back joins the queue at the end
// rather than taking the work back off whoever picked it up.

import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import type { PullMatcher } from "../../platform/sync/pull-routes";
import type { SourceHealth } from "../sources/engine";

// A heartbeat older than this means the collector is not running. Said to the
// reader ("your collector was last online at…") rather than acted on: two hours
// of silence is a closed laptop, not a machine that has given up its claim.
export const COLLECTOR_OFFLINE_MS = 2 * 60 * 60_000;

// And older than this means it has: the next machine in line takes over. Long
// enough that a weekend away with the lid shut does not hand the work to a
// laptop, short enough that a dead desktop does not hold the claim for a week.
// Neither number has been measured — docs/36 says so and says to revisit them.
export const COLLECTOR_FORFEIT_MS = 24 * 60 * 60_000;

// How often a collector says it is alive.
export const HEARTBEAT_MS = 60 * 60_000;

// A device that syncs does not claim until its first pull of the session has
// landed: claiming on a folder it has not read yet is how two machines both
// decide they are the collector. If no pull has landed by then, sync is broken
// or the account is offline, and a machine that never collects because it is
// waiting for a file it will never get is worse than two machines collecting.
export const CLAIM_SYNC_GRACE_MS = 30 * 60_000;

// An ask older than this is not executed. A regenerate the reader asked for
// before lunch is not one they still want in the evening.
export const ASK_EXPIRY_MS = 6 * 60 * 60_000;

export type AskScope = "retriage" | "full";

const COLLECTOR_PREFIX = "info-collector-";
const ASK_PREFIX = "info-ask-";
const JSON_SUFFIX = ".json";

export function collectorFile(deviceId: string): string {
  return `${COLLECTOR_PREFIX}${deviceId}${JSON_SUFFIX}`;
}

export function askFile(deviceId: string): string {
  return `${ASK_PREFIX}${deviceId}${JSON_SUFFIX}`;
}

// A reader asking for a briefing. The collector runs it when the file lands,
// not at its next wake — the reader is waiting for it.
export const ASK_PULL_ROUTE: PullMatcher = {
  id: "ask",
  matches: (path) => path.startsWith(ASK_PREFIX) && path.endsWith(JSON_SUFFIX),
};

// What a collector says about itself. Everything here is display or election
// input; nothing a reader needs to act on lives only here.
export interface CollectorClaim {
  deviceId: string;
  // The machine's own name, for a sentence a reader can act on ("the briefing
  // is built on kestrel, and kestrel has been off since Tuesday").
  deviceName: string;
  platform: string;
  // Whether this collector can render an article in a hidden webview. A reader
  // told its collector cannot is told why four of its sources only have
  // headlines (docs/17).
  hasWebviewFetch: boolean;
  // When this process started collecting, or null when this machine is not a
  // candidate at all — collection turned off. Null leaves the election at once
  // rather than waiting out the forfeit threshold.
  claimedAt: number | null;
  heartbeatAt: number;
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

// --- election ---------------------------------------------------------------

// Whether a claim is still in the running. A machine that turned collection off
// wrote claimedAt: null and is out; one whose heartbeat has stopped for a day
// has forfeited.
function isCandidate(claim: CollectorClaim, now: number): boolean {
  if (claim.claimedAt === null) return false;
  return now - claim.heartbeatAt <= COLLECTOR_FORFEIT_MS;
}

// Who collects. The candidate that has been claiming longest; the device id
// breaks a tie, because two machines started in the same millisecond must still
// pick the same winner as each other.
export function electCollector(claims: CollectorClaim[], now: number): CollectorClaim | null {
  let best: CollectorClaim | null = null;
  for (const claim of claims) {
    if (!isCandidate(claim, now)) continue;
    if (
      best === null ||
      claim.claimedAt! < best.claimedAt! ||
      (claim.claimedAt! === best.claimedAt! && claim.deviceId < best.deviceId)
    ) {
      best = claim;
    }
  }
  return best;
}

export function isElectedCollector(
  claims: CollectorClaim[],
  deviceId: string,
  now: number,
): boolean {
  return electCollector(claims, now)?.deviceId === deviceId;
}

// What a reader should say about the collectors it can see. The elected one when
// it is alive; otherwise whichever machine reported most recently, so the
// sentence is "last online at 08:14" rather than nothing at all. `online` is the
// two-hour threshold — a claim can be the elected one and still be asleep.
export interface CollectorReport {
  collector: CollectorClaim | null;
  online: boolean;
}

export function collectorReport(claims: CollectorClaim[], now: number): CollectorReport {
  const elected = electCollector(claims, now);
  if (elected && now - elected.heartbeatAt <= COLLECTOR_OFFLINE_MS) {
    return { collector: elected, online: true };
  }
  let latest: CollectorClaim | null = elected;
  for (const claim of claims) {
    if (!latest || claim.heartbeatAt > latest.heartbeatAt) latest = claim;
  }
  return { collector: latest, online: false };
}

// Whether this device may write a claim yet. A machine with no account attached
// is alone in the world and claims immediately; one that syncs waits for its
// first pull, and gives up waiting after the grace period.
export function mayClaim(state: {
  // Signed in with sync running. False means single-machine: nothing to wait for.
  syncing: boolean;
  // When the first pull of this session landed, or null if none has.
  pulledAt: number | null;
  startedAt: number;
  now: number;
}): boolean {
  if (!state.syncing) return true;
  if (state.pulledAt !== null) return true;
  return state.now - state.startedAt >= CLAIM_SYNC_GRACE_MS;
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

function isClaim(value: unknown): value is CollectorClaim {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<CollectorClaim>;
  return typeof v.deviceId === "string" && typeof v.heartbeatAt === "number";
}

function isAsk(value: unknown): value is AskRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<AskRecord>;
  return (
    typeof v.deviceId === "string" &&
    typeof v.askedAt === "number" &&
    (v.scope === "full" || v.scope === "retriage")
  );
}

async function readMatching<T>(
  prefix: string,
  keep: (value: unknown) => value is T,
): Promise<T[]> {
  let names: string[];
  try {
    const entries = await appData.readDir("");
    names = entries
      .filter((e) => e.isFile && e.name.startsWith(prefix) && e.name.endsWith(JSON_SUFFIX))
      .map((e) => e.name);
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const name of names) {
    try {
      const parsed: unknown = JSON.parse(await appData.readText(name));
      if (keep(parsed)) out.push(parsed);
    } catch {
      // A half-written or hand-edited file is one device's opinion missing, not
      // a reason to stop reading the others.
    }
  }
  return out;
}

// Every collector's claim, this device's own included. A device that has never
// seen another one gets a list of one, or an empty list before it has written
// its own.
export function readCollectorClaims(): Promise<CollectorClaim[]> {
  return readMatching(COLLECTOR_PREFIX, isClaim);
}

export function writeCollectorClaim(claim: CollectorClaim): Promise<void> {
  return writeTextAtomic(collectorFile(claim.deviceId), JSON.stringify(claim, null, 2));
}

export function readAsks(): Promise<AskRecord[]> {
  return readMatching(ASK_PREFIX, isAsk);
}

export function writeAsk(ask: AskRecord): Promise<void> {
  return writeTextAtomic(askFile(ask.deviceId), JSON.stringify(ask, null, 2));
}

// This device's own claim, for a collector picking up where the last session
// left off: lastAskAt and the last run's outcome survive a restart, claimedAt
// deliberately does not.
export async function readOwnClaim(deviceId: string): Promise<CollectorClaim | null> {
  const file = collectorFile(deviceId);
  try {
    if (!(await appData.exists(file))) return null;
    const parsed: unknown = JSON.parse(await appData.readText(file));
    return isClaim(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
