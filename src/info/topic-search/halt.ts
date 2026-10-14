// What a halt means for the nights after it (docs/info/88 「停手」). X said
// stop: signed out, a challenge, a rate limit, or a page the script no longer
// reads. The run ends on the spot either way (x-reader.ts); this is what this
// device remembers afterwards.
//
//   signed-out    nothing until the reader signs in again on the desktop: the
//                 session state says so, and every X run asks it first.
//   challenge,    the next night is skipped and the one after is tried once;
//   rate-limited  met again, X is not read until the reader says to resume.
//   structure     only that run stops, until the page script is fixed.
//
// A read that ends without a halt clears the record. Pure.

import type { XHalt, XHaltKind } from "../x/search-page";
import { nightsBetween } from "./nightly";

export interface XHaltRecord {
  kind: XHaltKind;
  detail: string;
  at: number;
  /** The night (anchor date) it happened on. */
  night: string;
  /** Challenges and limits in a row. */
  strikes: number;
  /** Not read again until the reader resumes it. */
  paused: boolean;
}

const BACKOFF = new Set<XHaltKind>(["challenge", "rate-limited"]);

/** The record after a halt. */
export function recordHalt(prior: XHaltRecord | null, halt: XHalt, at: number, night: string): XHaltRecord | null {
  if (halt.kind === "structure") return prior;
  if (!BACKOFF.has(halt.kind)) return { kind: halt.kind, detail: halt.detail, at, night, strikes: 0, paused: false };
  const strikes = prior && BACKOFF.has(prior.kind) ? prior.strikes + 1 : 1;
  return { kind: halt.kind, detail: halt.detail, at, night, strikes, paused: strikes >= 2 };
}

/** Why X may not be read on `night`, or null when it may. */
export function xGate(record: XHaltRecord | null, night: string): string | null {
  if (!record || !BACKOFF.has(record.kind)) return null;
  if (record.paused) return `X reading is paused after a second ${record.kind} until the reader resumes it`;
  if (nightsBetween(record.night, night) < 2) return `the night after a ${record.kind} is skipped`;
  return null;
}

/**
 * The reader said to read X again. Only a pause is theirs to lift: a skipped
 * night passes by itself, and signing out waits for them to sign in.
 */
export function resumeHalt(record: XHaltRecord | null): { record: XHaltRecord | null; lifted: boolean } {
  return record?.paused ? { record: null, lifted: true } : { record, lifted: false };
}

/** Whether a halt waits on the reader: everything but a changed page. */
export function haltNeedsReader(kind: XHaltKind): boolean {
  return kind !== "structure";
}
