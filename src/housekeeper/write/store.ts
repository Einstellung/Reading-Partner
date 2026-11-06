// The housekeeper's own two files (docs/platform/687): a version per write,
// written once and never changed, and a pending record per write held for the
// reader's confirmation. Both travel on the data channel; the data files
// themselves are only ever written by the domain's land and restore.

import { appData } from "../../platform/app/appdata";
import { readTextOrNull, writeTextAtomic } from "../../platform/app/atomic-fs";
import { contentHash } from "../../platform/app/content-hash";
import { requestRemotePurge } from "../../platform/sync";
import type { Gate, Initiator } from "./registry";

export const VERSIONS_DIR = "housekeeper-versions";
export const PENDING_DIR = "housekeeper-pending";

/** What the write path reads and writes. AppData unless a test hands one in. */
export interface WriteIo {
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  /** Sync-safe: the remote copy is asked to go before the local one does. */
  remove(path: string): Promise<void>;
  /** The file names in a directory; empty when it is not there. */
  list(dir: string): Promise<string[]>;
}

export const appWriteIo: WriteIo = {
  readText: readTextOrNull,
  writeText: writeTextAtomic,
  async remove(path) {
    await requestRemotePurge([path]);
    if (await appData.exists(path)) await appData.remove(path);
  },
  async list(dir) {
    const entries = await appData.readDir(dir).catch(() => []);
    return entries.filter((e) => e.isFile).map((e) => e.name);
  },
};

/** The base a copy was opened at: a hash of the file's text, or of its absence. */
export async function textBase(text: string | null): Promise<string> {
  if (text === null) return "absent";
  return contentHash(new TextEncoder().encode(text));
}

export interface VersionRecord {
  /** Time first, so names sort in the order the writes were made. */
  writeId: string;
  kind: string;
  id: string | null;
  at: number;
  device: string;
  initiator: Initiator;
  why: string;
  /** What `describe` said of the write. */
  lines: string[];
  /** The whole file before the write; null when there was no file. */
  beforeText: string | null;
  /** textBase of the file the write left. */
  afterHash: string;
  /** The write this one took back, on an undo's record. */
  undoes?: string;
}

export interface PendingRecord {
  pendingId: string;
  kind: string;
  id: string | null;
  base: string;
  /** The value the program returned, on an edit. */
  value?: unknown;
  /** The version an undo puts back, on an undo. */
  restore?: { writeId: string; text: string };
  gate: Gate;
  lines: string[];
  why: string;
  initiator: Initiator;
  at: number;
}

let lastStamp = 0;

// One more than the last stamp handed out, so two writes in one millisecond
// still sort in the order they were made.
function stamp(now: number): number {
  lastStamp = Math.max(now, lastStamp + 1);
  return lastStamp;
}

function suffix(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}

export function newWriteId(now: number): string {
  return `${new Date(stamp(now)).toISOString().replace(/[-:.]/g, "")}-${suffix()}`;
}

export function newPendingId(now: number): string {
  return `p-${new Date(stamp(now)).toISOString().replace(/[-:.]/g, "").toLowerCase()}-${suffix()}`;
}

export function versionPath(kind: string, writeId: string): string {
  return `${VERSIONS_DIR}/${kind}/${writeId}.json`;
}

export function pendingPath(pendingId: string): string {
  return `${PENDING_DIR}/${pendingId}.json`;
}

export async function writeVersion(io: WriteIo, record: VersionRecord): Promise<void> {
  await io.writeText(versionPath(record.kind, record.writeId), JSON.stringify(record));
}

/** One kind's versions for one piece of data, oldest first. */
export async function versionsOf(io: WriteIo, kind: string, id: string | null): Promise<VersionRecord[]> {
  const names = (await io.list(`${VERSIONS_DIR}/${kind}`)).filter((n) => n.endsWith(".json")).sort();
  const out: VersionRecord[] = [];
  for (const name of names) {
    const text = await io.readText(`${VERSIONS_DIR}/${kind}/${name}`);
    if (text === null) continue;
    const record = JSON.parse(text) as VersionRecord;
    if (record.id === id) out.push(record);
  }
  return out;
}

export async function writePending(io: WriteIo, record: PendingRecord): Promise<void> {
  await io.writeText(pendingPath(record.pendingId), JSON.stringify(record));
}

export async function readPending(io: WriteIo, pendingId: string): Promise<PendingRecord | null> {
  const text = await io.readText(pendingPath(pendingId));
  return text === null ? null : (JSON.parse(text) as PendingRecord);
}

export async function removePending(io: WriteIo, pendingId: string): Promise<void> {
  await io.remove(pendingPath(pendingId));
}

/** The pending records a run left, for the conversation it is delivered to. */
export async function pendingOfRun(io: WriteIo, runId: string): Promise<PendingRecord[]> {
  const out: PendingRecord[] = [];
  for (const name of (await io.list(PENDING_DIR)).sort()) {
    const text = await io.readText(`${PENDING_DIR}/${name}`);
    if (text === null) continue;
    const record = JSON.parse(text) as PendingRecord;
    if (record.initiator.runId === runId) out.push(record);
  }
  return out;
}
