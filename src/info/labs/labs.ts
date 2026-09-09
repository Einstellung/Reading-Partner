// Reading a labs file and answering the one question the screen asks of it.
// Pure, unit-tested; the filesystem is store.ts next door.

import { LABS_VERSION, type Charter, type Lab, type LabKind, type LabStatus } from "./types";

// One file's worth of rooms: the labs this build understands, and the entries it
// does not.
export interface ParsedLabs {
  labs: Lab[];
  // Entries with an id this build will not validate — a field a newer build on
  // another device wrote, a lab kind this one has never heard of. They are still
  // the reader's rooms and they still carry the id the records merge keys on, so
  // a write from here carries them through rather than deleting them on the
  // other device's behalf (same reasoning as sources/source-store.ts).
  foreign: unknown[];
  // True when the file held an entry no writer here produces: one with no id, or
  // a second entry under an id already taken. Those are in neither list, so the
  // bytes are set aside before the next write replaces them — readCollection
  // turns down a whole file that holds one, and the merge then copies one
  // device's file over the other's.
  repaired: boolean;
}

const LAB_KINDS: readonly LabKind[] = ["lab", "study"];
const LAB_STATUSES: readonly LabStatus[] = ["active", "archived"];

// The labs out of a parsed info-labs.json. Null when the bytes are not this
// writer's shape at all — not an object, or no labs array — which is what
// readGuardedJson quarantines.
export function parseLabsFile(raw: unknown): ParsedLabs | null {
  if (!isObject(raw)) return null;
  const list = raw.labs;
  if (!Array.isArray(list)) return null;
  const labs: Lab[] = [];
  const foreign: unknown[] = [];
  const seen = new Set<string>();
  let repaired = false;
  for (const entry of list) {
    const id = entryId(entry);
    if (id === "" || seen.has(id)) {
      repaired = true;
      continue;
    }
    seen.add(id);
    const lab = validateLab(entry);
    if (lab) labs.push(lab);
    else foreign.push(entry);
  }
  return { labs, foreign, repaired };
}

// The identity of a stored entry, whatever else is wrong with it. "" when there
// is none.
export function entryId(entry: unknown): string {
  if (!isObject(entry)) return "";
  return typeof entry.id === "string" ? entry.id : "";
}

// A stored entry read as a Lab, or null when a field this build depends on is
// missing or of the wrong type. Unknown fields ride along untouched: the object
// is returned as it was read, so a newer build's addition survives a write from
// here.
export function validateLab(entry: unknown): Lab | null {
  if (!isObject(entry)) return null;
  if (typeof entry.id !== "string" || entry.id === "") return null;
  if (typeof entry.name !== "string") return null;
  if (!LAB_KINDS.includes(entry.kind as LabKind)) return null;
  if (!LAB_STATUSES.includes(entry.status as LabStatus)) return null;
  if (typeof entry.createdAt !== "number") return null;
  const charter = validateCharter(entry.charter);
  if (!charter) return null;
  const sources = entry.sources;
  if (!Array.isArray(sources) || sources.some((s) => typeof s !== "string")) return null;
  return entry as unknown as Lab;
}

function validateCharter(raw: unknown): Charter | null {
  if (!isObject(raw)) return null;
  if (typeof raw.scope !== "string") return null;
  const questions = raw.questions;
  if (!Array.isArray(questions) || questions.some((q) => typeof q !== "string")) return null;
  if (raw.topicId !== null && typeof raw.topicId !== "string") return null;
  return raw as unknown as Charter;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** The rooms still open. Archived ones stay in the file; nothing reads them. */
export function activeLabs(labs: readonly Lab[]): Lab[] {
  return labs.filter((l) => l.status === "active");
}

/**
 * The labs a source's items are screened against.
 *
 * A source claimed by somebody is read for the claimants and nobody else: that
 * is what claiming a source means (docs/63 源归局不归人 — the source belongs to
 * the bureau, and a room says which of them it wants). A source no open room has
 * claimed is offered to all of them, because dropping it would silently make a
 * subscription invisible.
 *
 * Archived rooms never claim anything here: a room that is closed does not keep
 * a source out of the open ones' reach.
 */
export function labsForSource(labs: readonly Lab[], sourceId: string): Lab[] {
  const open = activeLabs(labs);
  const claiming = open.filter((l) => l.sources.includes(sourceId));
  return claiming.length > 0 ? claiming : open;
}

const HEX = "0123456789abcdef";

/**
 * A fresh lab id. `random` is a parameter so a test can pin the id rather than
 * match it with a regex; production passes nothing.
 */
export function newLabId(random: () => number = Math.random): string {
  let out = "lab-";
  for (let i = 0; i < 8; i++) out += HEX[Math.floor(random() * 16) % 16];
  return out;
}

/** The file body to write for a list of labs. */
export function labsFileBody(labs: readonly Lab[], foreign: readonly unknown[] = []): string {
  return JSON.stringify({ version: LABS_VERSION, labs: [...labs, ...foreign] }, null, 2);
}
