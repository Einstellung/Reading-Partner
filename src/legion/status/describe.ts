// The background_status text (tool.ts): which runs to show and the generic
// entry of each, from the run records, the claims and this device's sync. Pure
// but for the describers it is handed. Every time is said relative to now and
// as a local clock time, worked out here, so the model never subtracts.
//
// Honesty about where it runs: the run record travels by sync, the files a run
// writes as it goes mostly do not. A run executed on another device is told as
// that device's record last reached this one, with how old it is, and never as
// "nothing is happening".

import { MAX_ATTEMPTS, isTerminal, type Run } from "../run";
import type { DeviceClaim } from "../claim";
import type { RunAbout, RunDescriber, RunView } from "./registry";

/** A running run whose last report is older than this may be stalled or out of sight (the runner's own stall test). */
export const QUIET_MS = 15 * 60_000;
/** A claim heartbeat this recent means the device is on (claims beat hourly). */
export const DEVICE_ON_MS = 2 * 60 * 60_000;
/** Finished runs older than this are left out unless the query names a kind or a subject. */
export const RECENT_MS = 48 * 60 * 60_000;
export const MAX_ENTRIES = 8;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "45 s", "4 min", "2 h 5 min", "3 days". */
export function durationText(ms: number): string {
  const d = Math.max(0, ms);
  if (d < MIN) return `${Math.round(d / 1000)} s`;
  if (d < HOUR) return `${Math.floor(d / MIN)} min`;
  if (d < 2 * DAY) {
    const h = Math.floor(d / HOUR);
    const m = Math.floor((d % HOUR) / MIN);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  return `${Math.floor(d / DAY)} days`;
}

export function agoText(at: number, now: number): string {
  return now - at < MIN ? "just now" : `${durationText(now - at)} ago`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local clock time with the day said relative to now. */
export function whenText(at: number, now: number): string {
  const d = new Date(at);
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = dayOf(d);
  if (day === dayOf(new Date(now))) return `today ${clock}`;
  if (day === dayOf(new Date(now - DAY))) return `yesterday ${clock}`;
  return `${day} ${clock}`;
}

export type StatusWhich = "running" | "recent";

export interface StatusQuery {
  /** running: queued and running only; recent (default): those and what finished in the last 48 h. */
  which?: StatusWhich;
  kind?: string;
  /** A subject a describer names: a topic search's id or name. */
  about?: string;
}

export interface StatusInput {
  runs: readonly Run[];
  claims: readonly DeviceClaim[];
  deviceId: string;
  now: number;
  /** When this device last synced; null when it never has. */
  lastSyncAt: number | null;
  /** Whether this device syncs at all. */
  syncing: boolean;
  describer(kind: string): RunDescriber | null;
  /** The capabilities a kind needs, null when no worker for it is known here. */
  requires(kind: string): readonly string[] | null;
}

const unfinished = (run: Run) => !isTerminal(run.state);
const startOf = (run: Run) => run.startedAt ?? run.createdAt;

async function aboutOf(run: Run, describer: RunDescriber | null): Promise<RunAbout> {
  if (describer) {
    try {
      return await describer.about(run);
    } catch {
      // The generic headline below.
    }
  }
  return { title: `${run.kind} run`, subjects: [run.kind] };
}

function nameOf(deviceId: string, claims: readonly DeviceClaim[], me: string): string {
  const claim = claims.find((c) => c.deviceId === deviceId);
  const name = claim?.deviceName ? `"${claim.deviceName}"` : `another device (${deviceId.slice(0, 8)})`;
  return deviceId === me ? `this device${claim?.deviceName ? ` (${claim.deviceName})` : ""}` : name;
}

function syncLine(input: StatusInput): string {
  if (!input.syncing && input.lastSyncAt === null) return "this device does not sync, so it sees only the work it runs itself";
  if (input.lastSyncAt === null) return "this device has not finished a sync yet";
  return `this device last synced ${agoText(input.lastSyncAt, input.now)}`;
}

/** Who could pick up a queued run, by the claims this device sees. */
function queuedLine(run: Run, input: StatusInput): string {
  const needs = input.requires(run.kind);
  const able = input.claims.filter((c) => c.claimedAt !== null && (needs ?? []).every((n) => c.capabilities.includes(n)));
  const on = able.filter((c) => input.now - c.heartbeatAt <= DEVICE_ON_MS).sort((a, b) => b.heartbeatAt - a.heartbeatAt);
  if (on.length) {
    const c = on[0];
    return (
      `Queued: no device has picked it up yet. ${nameOf(c.deviceId, input.claims, input.deviceId)}, which can run it, ` +
      `last checked in ${agoText(c.heartbeatAt, input.now)}.`
    );
  }
  const last = [...able].sort((a, b) => b.heartbeatAt - a.heartbeatAt)[0];
  return (
    "Queued: no device has picked it up yet, and no device that can run it has checked in in the last 2 hours" +
    (last ? ` (${nameOf(last.deviceId, input.claims, input.deviceId)} last checked in ${agoText(last.heartbeatAt, input.now)})` : "") +
    "; it starts when one is on."
  );
}

function stateLines(run: Run, about: RunAbout, input: StatusInput, here: boolean): string[] {
  const { now } = input;
  const asked = `asked ${agoText(run.createdAt, now)} (${whenText(run.createdAt, now)})`;
  const report = run.progress ? `"${run.progress}"` : null;
  if (run.state === "pending") return [`State: queued, ${asked}.`, queuedLine(run, input)];
  const where = run.claimant ? nameOf(run.claimant.deviceId, input.claims, input.deviceId) : "an unknown device";
  const started = `started ${agoText(startOf(run), now)} (${whenText(startOf(run), now)})`;
  if (run.state === "running") {
    const attempt = run.attempts > 1 ? `; attempt ${run.attempts} of ${MAX_ATTEMPTS}` : "";
    const out = [`State: running on ${where}, ${started}, running for ${durationText(now - startOf(run))}${attempt}.`];
    const lastAt = run.lastProgressAt ?? run.startedAt ?? run.createdAt;
    if (report) out.push(`Last report, ${agoText(lastAt, now)}: ${report}.`);
    if (!here) {
      out.push(
        `This device cannot see ${where}'s progress directly, only the run record as last synced (${syncLine(input)}).`,
      );
      if (now - lastAt > QUIET_MS) {
        out.push(
          `Its last report reached this device ${agoText(lastAt, now)}: that computer may be asleep or off, or this ` +
            "device's copy is behind. Say so; do not say nothing is happening.",
        );
      }
    } else if (now - lastAt > QUIET_MS) {
      out.push(`Nothing reported for ${durationText(now - lastAt)}; the runner takes over a run quiet for 15 min.`);
    }
    return out;
  }
  const ended = run.endedAt ?? run.lastProgressAt ?? startOf(run);
  const took = `after ${durationText(ended - startOf(run))}`;
  const endedText = `${agoText(ended, now)} (${whenText(ended, now)})`;
  const on = run.claimant ? ` on ${where}` : "";
  if (run.state === "cancelled") return [`State: cancelled ${endedText}${on}, ${took}.`];
  if (run.state === "failed") return [`State: failed ${endedText}${on}, ${took}${report ? `. Reason or last report: ${report}` : ""}.`];
  if (about.skipped) return [`State: skipped ${endedText}${on}: ${about.skipped}.`];
  return [`State: done ${endedText}${on}, ${took}${report ? `. Its last line: ${report}` : ""}.`];
}

function matches(about: RunAbout, wanted: string): boolean {
  const w = wanted.trim().toLowerCase();
  return about.subjects.some((s) => s.toLowerCase() === w) || about.title.toLowerCase().includes(w);
}

/** The tool's text for a query. */
export async function backgroundStatusText(input: StatusInput, query: StatusQuery = {}): Promise<string> {
  const { now } = input;
  const which = query.which ?? "recent";
  const named = !!(query.kind || query.about);
  let runs = input.runs.filter((r) => (which === "running" ? unfinished(r) : true));
  if (query.kind) runs = runs.filter((r) => r.kind === query.kind);
  if (!named) runs = runs.filter((r) => unfinished(r) || now - (r.endedAt ?? startOf(r)) <= RECENT_MS);
  const described = await Promise.all(
    runs.map(async (run) => ({ run, describer: input.describer(run.kind), about: await aboutOf(run, input.describer(run.kind)) })),
  );
  const picked = described
    .filter((d) => !query.about || matches(d.about, query.about))
    .sort((a, b) => Number(unfinished(b.run)) - Number(unfinished(a.run)) || startOf(b.run) - startOf(a.run));
  const shown = picked.slice(0, MAX_ENTRIES);

  const me = input.claims.find((c) => c.deviceId === input.deviceId);
  const head =
    `Background work as of ${whenText(now, now)}, seen from this device${me?.deviceName ? ` (${me.deviceName})` : ""}; ` +
    `${syncLine(input)}.`;
  const filter = [
    which === "running" ? "queued or running" : named ? "" : "queued, running or finished in the last 48 h",
    query.kind ? `kind ${query.kind}` : "",
    query.about ? `about "${query.about}"` : "",
  ]
    .filter(Boolean)
    .join(", ");
  if (!shown.length) {
    return (
      `${head}\nNo background work on file here (${filter}). Runs from other devices appear only once synced; ` +
      "finished runs are folded away after a while."
    );
  }
  const entries: string[] = [];
  for (const { run, describer, about } of shown) {
    const here = run.claimant ? run.claimant.deviceId === input.deviceId : run.tier === "local";
    const view: RunView = {
      run,
      now,
      here,
      claimant: run.claimant ? (input.claims.find((c) => c.deviceId === run.claimant!.deviceId) ?? null) : null,
      claims: input.claims,
      deviceId: input.deviceId,
      ago: (at) => agoText(at, now),
      when: (at) => whenText(at, now),
    };
    let detail: string[] = [];
    if (describer?.detail) {
      try {
        detail = await describer.detail(view);
      } catch (e) {
        detail = [`(Details could not be read: ${e instanceof Error ? e.message : String(e)}.)`];
      }
    }
    entries.push(
      [`- ${about.title} [${run.kind}]`, ...stateLines(run, about, input, here), ...detail].join("\n  "),
    );
  }
  const more = picked.length > shown.length ? `\n(${picked.length - shown.length} older not shown.)` : "";
  return (
    `${head}\nShowing ${filter || "all"}, newest first:\n${entries.join("\n")}${more}\n` +
    "Tell the reader the state, elapsed time and progress as given here. Never say when a run will finish."
  );
}
