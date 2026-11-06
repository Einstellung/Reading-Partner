// One write, from the program's returned value to the file on disk
// (docs/platform/687 一次写入怎么走): compare path by path, hold the change to
// the five guards, ask the reader where the entry says to, re-read before
// landing, and keep the version it replaced. The two tools (tool.ts) and the
// confirmation card call in here; nothing here knows about a turn.

import { PALACE, type PalaceRow } from "../../palace";
import { currentDeviceId } from "../../platform/app/device";
import { changedPaths, underPattern } from "./paths";
import {
  dataPath,
  writableEntry,
  type Gate,
  type Initiator,
  type Problem,
  type WritableEntry,
  type WriteContext,
} from "./registry";
import {
  appWriteIo,
  newPendingId,
  newWriteId,
  readPending,
  removePending,
  textBase,
  versionsOf,
  writePending,
  writeVersion,
  type PendingRecord,
  type VersionRecord,
  type WriteIo,
} from "./store";

export interface WriteDeps {
  io: WriteIo;
  rows: readonly PalaceRow[];
  now: () => number;
  device: () => string;
  entryOf: (kind: string) => WritableEntry<unknown> | null;
}

export function liveWriteDeps(over: Partial<WriteDeps> = {}): WriteDeps {
  return {
    io: appWriteIo,
    rows: PALACE,
    now: Date.now,
    device: currentDeviceId,
    entryOf: writableEntry,
    ...over,
  };
}

/** A program's run, as the engine needs it: what it printed, and what it returned. */
export interface ProgramOutcome {
  printed: string;
  /** Undefined when the program returned nothing. */
  value: unknown;
}

export type WriteOutcome =
  | { status: "looked"; printed: string }
  | { status: "unchanged"; printed: string }
  | { status: "rejected"; printed: string; problems: Problem[] }
  | { status: "pending"; record: PendingRecord }
  | { status: "unconfirmable"; gate: Gate; lines: string[] }
  | { status: "stale" }
  | { status: "failed"; reason: string }
  | { status: "written"; writeId: string; lines: string[]; notes: string[] };

export type UndoOutcome =
  | WriteOutcome
  | { status: "nothing" }
  | { status: "moved"; since: VersionRecord[] };

export interface EditRequest {
  kind: string;
  id: string | null;
  why: string;
  initiator: Initiator;
  /** Whether a confirmation card can be raised for this write, or a run will carry it home. */
  canConfirm: boolean;
}

interface Target {
  entry: WritableEntry<unknown>;
  row: PalaceRow;
  path: string;
}

/** The entry and row for a kind, or the error that lists what can be edited. */
export function targetOf(kind: string, id: string | null, deps: WriteDeps): Target {
  const row = deps.rows.find((r) => r.kind === kind);
  const entry = row?.ai?.write === true ? deps.entryOf(kind) : null;
  if (!row || !entry) {
    const editable = deps.rows.filter((r) => r.ai?.write === true && deps.entryOf(r.kind) !== null);
    const list = editable.map((r) => `- ${r.kind}${r.about ? `: ${r.about}` : ""}`).join("\n");
    throw new Error(
      `"${kind}" cannot be edited here.` + (list === "" ? " Nothing can be edited yet." : ` These can:\n${list}`),
    );
  }
  return { entry, row, path: dataPath(row, id) };
}

// What the program handed back, read the way the copy went in: as JSON.
function asJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

/** The copy the program is given, and the base it was read at. */
export async function openCopy(target: Target, id: string | null): Promise<{ value: unknown; base: string }> {
  const opened = await target.entry.open(id);
  if (!opened) throw new Error(`There is no ${target.row.kind}${id === null ? "" : ` "${id}"`} to edit.`);
  return { value: asJson(opened.value), base: opened.base };
}

/** Steps 3 to 7 for one program's returned value. */
export async function settleEdit(
  request: EditRequest,
  copy: { value: unknown; base: string },
  program: ProgramOutcome,
  deps: WriteDeps,
): Promise<WriteOutcome> {
  const { printed } = program;
  if (program.value === undefined) return { status: "looked", printed };
  const target = targetOf(request.kind, request.id, deps);
  const { entry } = target;
  const after = asJson(program.value);
  const changed = changedPaths(copy.value, after);
  if (changed.length === 0) return { status: "unchanged", printed };

  const parsed = entry.parse(after);
  if (!parsed.ok) return { status: "rejected", printed, problems: [{ path: "", message: parsed.reason }] };
  const problems: Problem[] = [];
  for (const path of changed) {
    const computed = entry.computed.find((c) => underPattern(path, c.path));
    if (computed) {
      problems.push({ path, message: `computed by the app; change ${computed.input} instead` });
      continue;
    }
    if (entry.locked.some((pattern) => underPattern(path, pattern))) {
      problems.push({ path, message: "locked; nothing may write it" });
    }
  }
  if (problems.length > 0) return { status: "rejected", printed, problems };
  const ctx = contextOf(request, deps);
  problems.push(...(await entry.check(copy.value, parsed.value, ctx)));
  if (problems.length > 0) return { status: "rejected", printed, problems };

  const lines = [...entry.describe(copy.value, parsed.value)];
  const gate = entry.gate(copy.value, parsed.value);
  if (gate !== null) {
    if (!request.canConfirm) return { status: "unconfirmable", gate, lines };
    const record: PendingRecord = {
      pendingId: newPendingId(deps.now()),
      kind: request.kind,
      id: request.id,
      base: copy.base,
      value: parsed.value,
      gate,
      lines,
      why: request.why,
      initiator: request.initiator,
      at: deps.now(),
    };
    await writePending(deps.io, record);
    return { status: "pending", record };
  }
  return commit(target, request, copy.base, lines, (c) => entry.land(copy.value, parsed.value, c), undefined, deps);
}

function contextOf(request: Pick<EditRequest, "kind" | "id" | "why" | "initiator">, deps: WriteDeps): WriteContext {
  return { kind: request.kind, id: request.id, why: request.why, initiator: request.initiator, now: deps.now() };
}

// Steps 6 and 7: re-read, land, and keep the version the write replaced. The
// version is written once the land has, so it can carry the hash of what the
// land left; a land that fails leaves nothing behind.
async function commit(
  target: Target,
  request: Pick<EditRequest, "kind" | "id" | "why" | "initiator">,
  base: string,
  lines: string[],
  land: (ctx: WriteContext) => Promise<{ ok: true; notes: readonly string[] } | { ok: false; reason: string }>,
  undoes: string | undefined,
  deps: WriteDeps,
): Promise<WriteOutcome> {
  const beforeText = await deps.io.readText(target.path);
  if ((await textBase(beforeText)) !== base) return { status: "stale" };
  const ctx = contextOf(request, deps);
  const landed = await land(ctx);
  if (!landed.ok) return { status: "failed", reason: landed.reason };
  const afterHash = await textBase(await deps.io.readText(target.path));
  const record: VersionRecord = {
    writeId: newWriteId(deps.now()),
    kind: request.kind,
    id: request.id,
    at: ctx.now,
    device: deps.device(),
    initiator: request.initiator,
    why: request.why,
    lines,
    beforeText,
    afterHash,
    ...(undoes === undefined ? {} : { undoes }),
  };
  await writeVersion(deps.io, record);
  return { status: "written", writeId: record.writeId, lines, notes: [...landed.notes] };
}

/** The reader confirmed a card: carry the write on from step 6. The record goes either way. */
export async function confirmPending(pendingId: string, deps: WriteDeps): Promise<WriteOutcome | { status: "gone" }> {
  const record = await readPending(deps.io, pendingId);
  if (!record) return { status: "gone" };
  try {
    const target = targetOf(record.kind, record.id, deps);
    const opened = await target.entry.open(record.id);
    if (!opened || opened.base !== record.base) return { status: "stale" };
    const before = asJson(opened.value);
    if (record.restore) {
      return await restoreVersion(target, record, before, record.restore, deps);
    }
    const parsed = target.entry.parse(record.value);
    if (!parsed.ok) return { status: "failed", reason: parsed.reason };
    return await commit(
      target,
      record,
      record.base,
      record.lines,
      (ctx) => target.entry.land(before, parsed.value, ctx),
      undefined,
      deps,
    );
  } finally {
    await removePending(deps.io, pendingId);
  }
}

/** The reader said no: the record goes, nothing is written. */
export async function declinePending(pendingId: string, deps: WriteDeps): Promise<void> {
  if (await readPending(deps.io, pendingId)) await removePending(deps.io, pendingId);
}

/** Whether a card's write is still waiting. */
export async function pendingWaits(pendingId: string, deps: WriteDeps): Promise<boolean> {
  return (await readPending(deps.io, pendingId)) !== null;
}

function restoreVersion(
  target: Target,
  request: Pick<EditRequest, "kind" | "id" | "why" | "initiator"> & { base: string; lines: string[] },
  before: unknown,
  restore: { writeId: string; text: string },
  deps: WriteDeps,
): Promise<WriteOutcome> {
  const { entry } = target;
  const land = async (ctx: WriteContext) => {
    if (entry.restore) return entry.restore(restore.text, ctx);
    const old = entry.parse(JSON.parse(restore.text));
    if (!old.ok) return { ok: false as const, reason: old.reason };
    return entry.land(before, old.value, ctx);
  };
  return commit(target, request, request.base, request.lines, land, restore.writeId, deps);
}

/**
 * Take back the latest write to this data that is not taken back yet. Refused
 * when the data has moved since; an undo of a gated change waits for the reader
 * like the change did.
 */
export async function undoLatest(request: EditRequest, deps: WriteDeps): Promise<UndoOutcome> {
  const target = targetOf(request.kind, request.id, deps);
  const versions = await versionsOf(deps.io, request.kind, request.id);
  const undone = new Set(versions.flatMap((v) => (v.undoes ? [v.undoes] : [])));
  const latest = [...versions].reverse().find((v) => !v.undoes && !undone.has(v.writeId));
  if (!latest || latest.beforeText === null) return { status: "nothing" };
  const text = await deps.io.readText(target.path);
  const base = await textBase(text);
  // An undo lands through the domain, which restamps what it recomputes, so the
  // text it leaves is not the text the write before it left. What says nothing
  // else touched the data is the chain from that write to now joining end to
  // end: each record's before is the one ahead of it's after, and the file is
  // the last one's after (pitfall 688).
  const chain = versions.filter((v) => v.writeId >= latest.writeId);
  let joined = base === chain[chain.length - 1]!.afterHash;
  for (let i = 1; joined && i < chain.length; i++) {
    joined = (await textBase(chain[i]!.beforeText)) === chain[i - 1]!.afterHash;
  }
  if (!joined) {
    return { status: "moved", since: versions.filter((v) => v.writeId > latest.writeId) };
  }
  const current = await openCopy(target, request.id);
  const old = target.entry.parse(JSON.parse(latest.beforeText));
  if (!old.ok) return { status: "failed", reason: old.reason };
  const lines = [...target.entry.describe(current.value, old.value)];
  const why = request.why === "" ? `undo: ${latest.why}` : request.why;
  const restore = { writeId: latest.writeId, text: latest.beforeText };
  const gate = target.entry.gate(current.value, old.value);
  if (gate !== null) {
    if (!request.canConfirm) return { status: "unconfirmable", gate, lines };
    const record: PendingRecord = {
      pendingId: newPendingId(deps.now()),
      kind: request.kind,
      id: request.id,
      base: current.base,
      restore,
      gate,
      lines,
      why,
      initiator: request.initiator,
      at: deps.now(),
    };
    await writePending(deps.io, record);
    return { status: "pending", record };
  }
  return restoreVersion(target, { ...request, why, base: current.base, lines }, current.value, restore, deps);
}
