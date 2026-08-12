// The reading end of the briefing (docs/36): what the screens read when this
// device is not the one collecting.
//
// A collector's briefing comes out of a pipeline it is running — progress,
// halts and errors all from memory, the files only a product. A reader has no
// pipeline: it reads the two files the collector published, sends no request to
// a subscribed site, and calls no model on their behalf. BriefingView is the
// shape both answer to, so the screens do not branch on which one they have.
//
// Everything a reader can be asked about an article is one of four answers, and
// the fourth is the one worth having: a briefing arrives in one file and its
// bodies in another, reconciled independently, so for one sync interval a reader
// can hold today's briefing beside yesterday's text. Rather than render the
// wrong article under the right headline it says the text is still on its way,
// and hides Keep and the article chat while it is.

import { sanitizeArticleHtml } from "../extract/sanitize";
import {
  bodiesMatch,
  loadPublishedBodies,
  loadPublishedBriefing,
  PUBLISHED_BODIES_FILE,
  PUBLISHED_BRIEFING_FILE,
  type PublishedBodies,
} from "./publish";
import { removeCollectedPoolFiles } from "./pool-store";
import { pruneStaleDailyFiles, todayLocal } from "./store";
import {
  collectorReport,
  readCollectorClaims,
  writeAsk,
  type AskScope,
  type CollectorClaim,
  type CollectorReport,
} from "./handoff";
import { currentDeviceId } from "../../platform/app/device";
import type { InfoSnapshot, RunStart } from "./pipeline";
import type { Briefing } from "./types";

// What asking for a briefing did. Two of the three come from the pipeline (it
// started a run, or it was already running one and this start was refused); the
// third is what a device with no pipeline can do instead — leave the request in
// a file for the machine that collects (docs/36).
//
// Three, not two, and never a bare void: they call for three different things on
// screen. "started" gets a progress card, "busy" joins the card of the run
// already going rather than drawing one nothing will update, and "asked" gets no
// card at all, because there is no run on this device to show the progress of.
export type RequestOutcome = RunStart | "asked";

// A request and the thing it started, for a caller that needs both answers at
// different times. `outcome` is known now, before anything is drawn. `done`
// settles when what the outcome names is over: the run finished, the run being
// joined finished, or — the only case that can reject — the request reached
// disk, or did not.
export interface RequestHandle {
  outcome: RequestOutcome;
  done: Promise<void>;
}

// One item's body as a screen needs it: ready to render, ready to keep, and
// honest about whether the article itself was ever read.
export interface ArticleBody {
  html: string;
  text: string;
  summaryOnly: boolean;
}

// Why an article looks the way it does. Four answers, one screen each.
export type ArticleState =
  // The body is here.
  | { kind: "body"; body: ArticleBody }
  // The briefing is newer than the bodies beside it: the text is on its way.
  | { kind: "pending" }
  // Triage read it and dropped it, so no body was ever kept. The briefing still
  // carries its title and the category it was dropped under.
  | { kind: "filtered"; category: string }
  // The source publishes summaries and nothing else, or the full text could not
  // be had. Not an error and not a wait — this is as much as there will be.
  | { kind: "summaryOnly" }
  // Not in this briefing at all.
  | { kind: "unknown" };

// What a screen reads. A collector's implementation is its pipeline; a reader's
// is the class below.
export interface BriefingView {
  snapshot(): InfoSnapshot;
  subscribe(fn: () => void): () => void;
  // Bring the snapshot up to date. A collector finishes a run it was killed in
  // the middle of and starts the day's first; a reader re-reads what was
  // published. Cheap when there is nothing to do, and called on every return to
  // the foreground and after every pull.
  init(): Promise<void>;
  // Stop the run in flight. A reader has none and does nothing.
  stop(): void;
  // One item's body, or why there is none.
  article(itemId: string): Promise<ArticleState>;
  // Ask for a new briefing at this scope. A collector starts a run, or reports
  // that one was already going; a reader writes the request for the collector to
  // pick up on its next sync.
  //
  // Not async, and not a bare promise of the eventual briefing: what has to be
  // answered now, before anything is drawn, is which of the three happened. The
  // three are drawn differently, and getting it wrong is what left a progress
  // card sitting on its first frame while the run it collided with went on
  // without it.
  request(scope: AskScope): RequestHandle;
  // What to say about the machine that collects. Empty on the machine that is
  // it — its own trouble is already in the snapshot's error.
  notices(now?: number): string[];
  // Which sites the collecting machine has a session with, and what it is
  // called. Null on the collector itself, which has the real sign-in rows and
  // the cookie jar behind them.
  collectorSites(): CollectorSites | null;
}

// A reader's read-only view of the sign-in state (docs/36): the site rows come
// from the source list as they always did, but the answer comes off the
// collector's claim, because the session is on that machine and so is the only
// place it can be repaired.
export interface CollectorSites {
  deviceName: string;
  sites: Record<string, boolean>;
}

const IDLE: InfoSnapshot = {
  briefing: null,
  running: false,
  stopping: false,
  phase: "idle",
  collect: null,
  activity: null,
  error: null,
};

// --- pure -------------------------------------------------------------------

// Which of the four answers an item gets. The filtered check comes first: a
// dropped item never had a body, so no fingerprint can make one appear, and
// telling the reader to wait for it would be a wait that never ends.
export function articleState(
  briefing: Briefing | null,
  bodies: PublishedBodies | null,
  itemId: string,
): ArticleState {
  if (!briefing || !briefing.items[itemId]) return { kind: "unknown" };
  const dropped = briefing.filtered.find((f) => f.itemId === itemId);
  if (dropped) return { kind: "filtered", category: dropped.category };
  if (!bodiesMatch(briefing, bodies)) return { kind: "pending" };
  const body = bodies!.bodies[itemId];
  if (!body || (!body.text && !body.html)) return { kind: "summaryOnly" };
  return {
    kind: "body",
    body: {
      // Sanitized on the way out, not on the way in: this HTML arrived over a
      // sync folder and is rendered with dangerouslySetInnerHTML, so the guard
      // belongs where the rendering is and not where the file was written.
      html: body.html ? sanitizeArticleHtml(body.html) : "",
      text: body.text,
      summaryOnly: body.summaryOnly,
    },
  };
}

// Whether a pulled file is one this screen shows. A reader's briefing arrives
// over sync rather than out of a run, so a pull is its "something changed".
export function isReaderFile(path: string): boolean {
  return (
    path === PUBLISHED_BRIEFING_FILE ||
    path === PUBLISHED_BODIES_FILE ||
    /^info-collector-.+\.json$/.test(path)
  );
}

// How long ago, in the shape a sentence wants ("3 hours ago"). Coarse on
// purpose: the answer to "is my collector alive" is a shape, not a duration.
export function sinceLabel(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// What to tell the reader about the machine doing the collecting. Nobody is
// looking at that machine's screen, so anything it would have said there has to
// come out here instead (docs/36).
//
// In order of what stops a briefing arriving: no collector at all, a collector
// that is not running, a run that stopped short, a site that needs signing in
// again. All of them are true at once often enough to be worth saying together.
export function collectorNotices(report: CollectorReport, now: number): string[] {
  const c = report.collector;
  if (!c) {
    return [
      "No computer is collecting yet. Open Reading Partner on a desktop and make it the collector.",
    ];
  }
  const out: string[] = [];
  if (!report.online) {
    out.push(`${c.deviceName} last checked in ${sinceLabel(now - c.heartbeatAt)}.`);
  }
  if (c.halt) out.push(`Its last run stopped: ${c.halt}`);
  const signedOut = Object.keys(c.sites).filter((host) => !c.sites[host]);
  if (signedOut.length > 0) {
    out.push(
      `Some of today's items only have a summary: ${signedOut.join(", ")} needs signing in again on ${c.deviceName}.`,
    );
  }
  return out;
}

// What a device that used to collect left behind. A phone or tablet that ran an
// older build has day after day of briefing-*.json and info-articles-*.json on
// it (one day's article cache measured 4.4 MB) plus the item pool, and nothing
// clears them any more: the pipeline used to prune on every run and a reader
// never constructs one (docs/36). Run once at startup.
//
// info-pool-marks.json stays. It is in the sync range and it is the collector's
// record of what has already been briefed — deleting it here would upload the
// deletion to the machine that needs it.
//
// Best effort throughout: this costs disk, never correctness.
export async function clearCollectorLeftovers(): Promise<void> {
  await pruneStaleDailyFiles(todayLocal()).catch(() => {});
  await removeCollectedPoolFiles().catch(() => {});
}

// --- the reader -------------------------------------------------------------

export class InfoReader implements BriefingView {
  private snap: InfoSnapshot = IDLE;
  private bodies: PublishedBodies | null = null;
  private claims: CollectorClaim[] = [];
  private listeners = new Set<() => void>();
  private reading: Promise<void> | null = null;

  snapshot(): InfoSnapshot {
    return this.snap;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Re-read the published pair and the collectors' claims. Coalesced: a pull
  // that lands three of these files must not read them three times over.
  init(): Promise<void> {
    if (this.reading) return this.reading;
    this.reading = this.read().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  // Nothing is running, so nothing can be stopped. Present so a screen can hand
  // the same object to a Stop button it also shows a collector.
  stop(): void {}

  // Nothing runs here, so the answer is always "asked". The request goes in a
  // file named after this device, overwritten whole: a newer ask replaces an
  // older one, and there is nothing to merge because nobody else writes it.
  //
  // `done` is where the failure shows. A request the user was told had been
  // passed on, and that never left the device, is worse than no request at all,
  // so the write is handed over to be waited on rather than swallowed here.
  request(scope: AskScope): RequestHandle {
    return {
      outcome: "asked",
      done: writeAsk({ deviceId: currentDeviceId(), askedAt: Date.now(), scope }),
    };
  }

  async article(itemId: string): Promise<ArticleState> {
    await this.ready();
    return articleState(this.snap.briefing, this.bodies, itemId);
  }

  // What to say about the machine that collects, given what its claims say.
  report(now: number = Date.now()): CollectorReport {
    return collectorReport(this.claims, now);
  }

  notices(now: number = Date.now()): string[] {
    return collectorNotices(this.report(now), now);
  }

  collectorSites(): CollectorSites | null {
    const c = this.report().collector;
    return c ? { deviceName: c.deviceName, sites: c.sites } : null;
  }

  private async ready(): Promise<void> {
    if (this.snap.briefing === null) await this.init();
  }

  private async read(): Promise<void> {
    const [briefing, bodies, claims] = await Promise.all([
      loadPublishedBriefing().catch(() => null),
      loadPublishedBodies().catch(() => null),
      readCollectorClaims().catch(() => [] as CollectorClaim[]),
    ]);
    this.bodies = bodies;
    this.claims = claims;
    // No date check, deliberately: the date is the collector's. A reader opened
    // after midnight, or in another timezone, sees the latest briefing labelled
    // with the day it is for rather than an empty screen.
    this.snap = { ...IDLE, briefing };
    for (const fn of this.listeners) fn();
  }
}
