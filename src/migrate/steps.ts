// The seven steps, in the order they have to run in.
//
// 1 repairs the anchors that name the wrong thread, because 2 and 3 derive from
// the anchor and deriving from a wrong thread computes the wrong message.
// 2 repairs the two mistyped thread ids and drops the one invented anchor.
// 3 gives every message an id, derived so two devices agree.
// 4 rewrites every legacy anchor to the composite form, which needs 3's ids.
// 5 cleans tool-call residue out of the bodies and lifts the anchors buried in
//   it into the frontmatter.
// 6 widens the observation ids from 8 to 16 hex, which touches every file at
//   once and so goes after the per-file work.
// 7 widens the same ids where statements point at them, which needs 6's
//   derivation and would otherwise leave every statement's evidence dangling.
//
// Every step is self-detecting: it asks the data whether it is still in the old
// shape. None of them consults a stored flag, and none writes one.

import {
  parseObservation,
  parseTombstones,
  serializeObservation,
  serializeTombstone,
} from "../memory/observations/files";
import { cleanObservationBody } from "../memory/observations/residue";
import { ObservationFileStore } from "../memory/observations/store";
import type { Observation } from "../memory/observations/types";
import { STATEMENTS_FILE } from "../memory/statements/store";
import {
  composeAnchor,
  normalizeAnchor,
  repairParentAnchor,
  repairTypoAnchor,
  type AnchorOutcome,
} from "./anchors";
import { asObservationFs } from "./fs";
import { deriveMessageId, deriveObservationId, NARROW_OBSERVATION_ID } from "./hash";
import { allMessages, loadThreads, serializeThreadFile, type ThreadIndex } from "./threads";
import {
  emptyStep,
  refuse,
  sample,
  type MigrationFs,
  type Refusal,
  type StepReport,
} from "./types";

// An observation entry file at either width. The narrow one is what a device
// that has not migrated still holds; both are read for the whole of 0.12.
const ENTRY_FILE = /^(m-(?:[0-9a-f]{16}|[0-9a-f]{8}))\.md$/;
const CONFLICT_FILE = /^(m-(?:[0-9a-f]{16}|[0-9a-f]{8}))(\.conflict-[0-9a-f]+\.md)$/;
const TOMBSTONE_FILE = "deleted-observations.jsonl";
// A bare observation id in prose, the same shape memory/observations/links.ts
// reads. Narrow only: a mention already widened must not match, which is what
// makes the rewrite idempotent.
const NARROW_MENTION = /(^|[^0-9a-z-])(m-[0-9a-f]{8})(?![0-9a-f])/gi;
// An observation id this migration has already widened, or one minted since.
const WIDE_OBSERVATION_ID = /^m-[0-9a-f]{16}$/;

export async function topicDirs(fs: MigrationFs): Promise<string[]> {
  return (await fs.listSubdirs("")).filter((n) => n.startsWith("memory-")).sort();
}

interface EntryFile {
  dir: string;
  name: string;
  path: string;
  id: string;
  entry: Observation;
}

// Every parseable observation entry across every topic. A file that does not
// parse is reported by the step that met it and never rewritten: a migration
// that cannot read a file has no business replacing it.
async function readEntries(fs: MigrationFs, step: StepReport): Promise<EntryFile[]> {
  const out: EntryFile[] = [];
  for (const dir of await topicDirs(fs)) {
    for (const name of (await fs.listDir(dir)).sort()) {
      const m = ENTRY_FILE.exec(name);
      if (!m) continue;
      const path = `${dir}/${name}`;
      const text = await fs.read(path);
      const entry = text === null ? null : parseObservation(text);
      if (!entry) {
        refuse(step, path, "file does not parse as an observation");
        continue;
      }
      out.push({ dir, name, path, id: m[1], entry });
    }
  }
  return out;
}

// --- steps 1, 2 and 4: one walk over the stored message anchors -------------

// The three anchor steps differ only in which transform they apply and how they
// count what comes back, so the walk is written once. Conflict copies are left
// alone throughout: a copy is the losing version of a file two devices both
// edited, nothing derived reads its anchors, and rewriting one would make it
// stop being the record of what the other device wrote.
async function walkAnchors(
  fs: MigrationFs,
  step: StepReport,
  index: ThreadIndex,
  repair: (anchor: string, index: ThreadIndex) => AnchorOutcome,
): Promise<void> {
  for (const file of await readEntries(fs, step)) {
    const next: string[] = [];
    let changed = false;
    for (const anchor of file.entry.anchors.messageIds) {
      step.scanned++;
      const outcome = repair(anchor, index);
      if (outcome.kind === "rewritten") {
        step.changed++;
        changed = true;
        if (outcome.tie) step.counts.resolvedToUserTurn = (step.counts.resolvedToUserTurn ?? 0) + 1;
        sample(step, `${file.id}: ${anchor} -> ${outcome.anchor}`);
        if (!next.includes(outcome.anchor)) next.push(outcome.anchor);
        continue;
      }
      if (outcome.kind === "dropped") {
        step.changed++;
        changed = true;
        step.counts.dropped = (step.counts.dropped ?? 0) + 1;
        sample(step, `${file.id}: dropped ${anchor} (${outcome.why})`);
        continue;
      }
      if (outcome.kind === "refused") refuse(step, `${file.id}: ${anchor}`, outcome.why);
      else if (outcome.kind === "other-step") {
        step.counts.leftToAnotherStep = (step.counts.leftToAnotherStep ?? 0) + 1;
      } else step.skipped++;
      if (!next.includes(anchor)) next.push(anchor);
    }
    if (!changed) continue;
    await fs.write(
      file.path,
      serializeObservation({ ...file.entry, anchors: { ...file.entry.anchors, messageIds: next } }),
    );
  }
}

export async function stepParentAnchors(fs: MigrationFs): Promise<StepReport> {
  const step = emptyStep("parent-anchors", "message anchors naming the parent of their thread");
  await walkAnchors(fs, step, await loadThreads(fs), repairParentAnchor);
  return step;
}

export async function stepTypoAnchors(fs: MigrationFs): Promise<StepReport> {
  const step = emptyStep("typo-anchors", "mistyped thread ids and invented anchors");
  await walkAnchors(fs, step, await loadThreads(fs), repairTypoAnchor);
  return step;
}

export async function stepComposeAnchors(fs: MigrationFs): Promise<StepReport> {
  const step = emptyStep("compose-anchors", "legacy pair anchors rewritten to the composite form");
  await walkAnchors(fs, step, await loadThreads(fs), composeAnchor);
  return step;
}

// --- step 3: every message gets an id ---------------------------------------

export async function stepMessageIds(fs: MigrationFs): Promise<StepReport> {
  const step = emptyStep("message-ids", "message ids backfilled");
  const index = await loadThreads(fs);
  for (const path of index.unreadable) refuse(step, path, "thread file does not parse");

  const messages = allMessages(index);
  // The derivation is verified over this store before a byte is written. It is
  // thread + stamp + role, because thread + stamp alone names two messages
  // wherever a user turn and its reply were appended in the same millisecond.
  const owners = new Map<string, string[]>();
  for (const { threadId, message } of messages) {
    const id = message.id ?? deriveMessageId(threadId, message.ts, message.role);
    const holders = owners.get(id) ?? [];
    holders.push(`${threadId}:${message.ts}:${message.role}`);
    owners.set(id, holders);
  }
  const collisions = [...owners.entries()].filter(([, holders]) => holders.length > 1);
  step.scanned = messages.length;
  step.counts.alreadyIdentified = messages.filter((m) => m.message.id !== undefined).length;
  step.skipped = step.counts.alreadyIdentified;
  if (collisions.length > 0) {
    step.aborted = `${collisions.length} derived message id(s) name more than one message`;
    for (const [id, holders] of collisions) refuse(step, id, `claimed by ${holders.join(" and ")}`);
    return step;
  }

  const dirty = new Set<string>();
  for (const { threadId, file, message } of messages) {
    if (message.id !== undefined) continue;
    const id = deriveMessageId(threadId, message.ts, message.role);
    // Assigned in place so every key this build does not know — parts, images,
    // whatever a later build adds — rides through untouched. The store puts the
    // id first when it appends one; the key order of an object literal is not
    // reproducible here without rebuilding the message, so the id goes last and
    // the bytes still match on both devices because both take this path.
    message.id = id;
    step.changed++;
    dirty.add(file.path);
    sample(step, `${threadId}:${message.ts} ${message.role} -> ${id}`);
  }
  for (const file of index.files) {
    if (!dirty.has(file.path)) continue;
    await fs.write(file.path, serializeThreadFile(file));
  }
  return step;
}

// --- step 5: tool-call residue out of the stored bodies ----------------------

export async function stepCleanBodies(fs: MigrationFs): Promise<StepReport> {
  const step = emptyStep("clean-bodies", "tool-call residue cleaned out of observation bodies");
  const index = await loadThreads(fs);
  for (const file of await readEntries(fs, step)) {
    step.scanned++;
    // The same function the write path calls (residue.ts), not a second one.
    const cleaned = cleanObservationBody(file.entry.body, file.entry.anchors);
    const before = file.entry.anchors;
    const recoveredAnnotations = cleaned.anchors.annotationIds.filter(
      (id) => !before.annotationIds.includes(id),
    );
    const recoveredMessages = cleaned.anchors.messageIds.filter(
      (id) => !before.messageIds.includes(id),
    );
    // An anchor lifted out of the XML has never been through steps 1, 2 and 4,
    // and leaving it in the legacy shape would give the next run work to do.
    const messageIds: string[] = [];
    for (const anchor of cleaned.anchors.messageIds) {
      const normalized = before.messageIds.includes(anchor)
        ? anchor
        : (normalizeAnchor(anchor, index) ?? "");
      if (normalized && !messageIds.includes(normalized)) messageIds.push(normalized);
    }
    const next: Observation = {
      ...file.entry,
      body: cleaned.body,
      anchors: { annotationIds: cleaned.anchors.annotationIds, messageIds },
    };
    const text = serializeObservation(next);
    if (text === serializeObservation(file.entry)) {
      step.skipped++;
      continue;
    }
    step.changed++;
    step.counts.annotationIdsRecovered =
      (step.counts.annotationIdsRecovered ?? 0) + recoveredAnnotations.length;
    step.counts.messageAnchorsRecovered =
      (step.counts.messageAnchorsRecovered ?? 0) + recoveredMessages.length;
    sample(
      step,
      `${file.id}: -${file.entry.body.length - cleaned.body.length} chars, ` +
        `+${recoveredAnnotations.length} annotation, +${recoveredMessages.length} message`,
    );
    await fs.write(file.path, text);
  }
  return step;
}

// --- step 6: observation ids widen from 8 to 16 hex --------------------------

// Not per-file independent, and not order-free either: the map is built first,
// then the entry and conflict files are renamed, then every `m-<8hex>` mention
// in every body is rewritten, then the tombstones are widened, then the index
// is rebuilt. Each pass is idempotent on its own, so a run that dies between
// two of them finishes on the next one — the map is a function of the old id
// (hash.ts) and can be recomputed from either side of any rename.
export async function stepWidenObservationIds(fs: MigrationFs): Promise<StepReport> {
  const step = emptyStep("widen-observation-ids", "observation ids widened from 8 to 16 hex");
  const dirs = await topicDirs(fs);

  // Every narrow id anywhere: file names, conflict copies, tombstones and the
  // mentions in the bodies. A mention naming an observation whose file this
  // device has never seen still widens, and widens the same way on the device
  // that does have it.
  const narrow = new Set<string>();
  const wide = new Set<string>();
  for (const dir of dirs) {
    for (const name of await fs.listDir(dir)) {
      const entry = ENTRY_FILE.exec(name) ?? CONFLICT_FILE.exec(name);
      if (entry) {
        if (NARROW_OBSERVATION_ID.test(entry[1])) narrow.add(entry[1]);
        else wide.add(entry[1]);
      }
      if (!ENTRY_FILE.test(name) && !CONFLICT_FILE.test(name)) continue;
      const text = (await fs.read(`${dir}/${name}`)) ?? "";
      for (const m of text.matchAll(NARROW_MENTION)) narrow.add(m[2].toLowerCase());
    }
    for (const id of parseTombstones((await fs.read(`${dir}/${TOMBSTONE_FILE}`)) ?? "")) {
      if (NARROW_OBSERVATION_ID.test(id)) narrow.add(id);
    }
  }
  step.scanned = narrow.size;
  step.counts.alreadyWide = wide.size;

  const plan = planWidening(narrow);
  if (plan.collisions.length > 0) {
    // Nothing is per-file here: a partial rename with a colliding map would
    // leave two observations sharing a file name. The whole step stands down.
    for (const c of plan.collisions) refuse(step, c.what, c.why);
    step.aborted = "derived observation ids collide";
    return step;
  }
  const map = plan.map;

  // Pass A: rename the entry and conflict files, and rewrite the id each one
  // states in its own frontmatter.
  for (const dir of dirs) {
    for (const name of (await fs.listDir(dir)).sort()) {
      const m = ENTRY_FILE.exec(name) ?? CONFLICT_FILE.exec(name);
      if (!m) continue;
      const next = map.get(m[1]);
      if (!next) continue;
      const path = `${dir}/${name}`;
      const text = await fs.read(path);
      if (text === null) continue;
      const renamed = `${dir}/${name.replace(m[1], next)}`;
      // A file already sitting at the new name is this migration's own earlier
      // output — the derivation is a function, so nothing else can land there —
      // and it is not overwritten. That is what makes a run killed between the
      // write and the remove finish on the next one, and it is also the right
      // answer for the store where the widened entry has since been rewritten
      // and the narrow one came back from a device that never migrated.
      if ((await fs.read(renamed)) === null) {
        await fs.write(renamed, rewriteIdField(text, m[1], next));
      } else {
        step.counts.alreadyRenamed = (step.counts.alreadyRenamed ?? 0) + 1;
      }
      await fs.remove(path);
      step.changed++;
      step.counts.filesRenamed = (step.counts.filesRenamed ?? 0) + 1;
      if (CONFLICT_FILE.test(name)) {
        step.counts.conflictCopiesRenamed = (step.counts.conflictCopiesRenamed ?? 0) + 1;
      }
      sample(step, `${path} -> ${renamed}`);
    }
  }

  // Pass B: every narrow mention in every body. Over the body alone, so the
  // frontmatter — where an id is a field pass A owns — is never touched here.
  for (const dir of dirs) {
    for (const name of (await fs.listDir(dir)).sort()) {
      if (!ENTRY_FILE.test(name) && !CONFLICT_FILE.test(name)) continue;
      const path = `${dir}/${name}`;
      const text = await fs.read(path);
      if (text === null) continue;
      const split = /^---\n[\s\S]*?\n---\n?/.exec(text);
      if (!split) continue;
      const head = text.slice(0, split[0].length);
      const body = text.slice(split[0].length);
      let mentions = 0;
      const rewritten = body.replace(NARROW_MENTION, (whole, lead: string, id: string) => {
        const next = map.get(id.toLowerCase());
        if (!next) return whole;
        mentions++;
        return `${lead}${next}`;
      });
      if (mentions === 0) continue;
      await fs.write(path, head + rewritten);
      step.counts.mentionsRewritten = (step.counts.mentionsRewritten ?? 0) + mentions;
      step.counts.bodiesWithMentions = (step.counts.bodiesWithMentions ?? 0) + 1;
    }
  }

  // Pass C: the tombstones. Append-only — an existing line is never rewritten,
  // because rewriting it would make it a different record to the sync merge and
  // both versions would then survive (files.ts). The narrow line stays and says
  // what it always said; the widened one is what stops the renamed entry file
  // coming back to life in the index.
  for (const dir of dirs) {
    const path = `${dir}/${TOMBSTONE_FILE}`;
    const text = await fs.read(path);
    if (text === null) continue;
    const present = parseTombstones(text);
    const lines: string[] = [];
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (line === "") continue;
      let record: { id?: unknown; at?: unknown };
      try {
        record = JSON.parse(line) as { id?: unknown; at?: unknown };
      } catch {
        continue;
      }
      if (typeof record.id !== "string") continue;
      const next = map.get(record.id);
      if (!next || present.has(next)) continue;
      present.add(next);
      lines.push(serializeTombstone(next, typeof record.at === "string" ? record.at : ""));
    }
    if (lines.length === 0) continue;
    const tail = text.endsWith("\n") || text === "" ? text : `${text}\n`;
    await fs.write(path, `${tail}${lines.join("\n")}\n`);
    step.counts.tombstonesWidened = (step.counts.tombstonesWidened ?? 0) + lines.length;
  }

  // Pass D: the index, which is derived, rebuilt by the code that owns it.
  for (const dir of dirs) {
    const store = new ObservationFileStore(dir.slice("memory-".length), asObservationFs(fs));
    await store.rebuildIndex();
  }
  return step;
}

// The old -> new map, and the collisions that stop the step.
//
// A collision here is two DIFFERENT narrow ids deriving to one wide id, which
// would put two observations in one file. A wide file that already sits at a
// derived name is not a collision — it is where that observation now lives.
//
// `derive` is a parameter so the refusal can be exercised: with the real hash,
// two of the store's ids colliding is a 2^-64 event that no fixture can build.
export function planWidening(
  narrow: Iterable<string>,
  derive: (id: string) => string = deriveObservationId,
): { map: Map<string, string>; collisions: Refusal[] } {
  const map = new Map<string, string>();
  const taken = new Map<string, string>();
  const collisions: Refusal[] = [];
  for (const id of [...narrow].sort()) {
    const next = derive(id);
    const clash = taken.get(next);
    if (clash) {
      collisions.push({ what: next, why: `derived from both ${clash} and ${id}` });
      continue;
    }
    taken.set(next, id);
    map.set(id, next);
  }
  return { map, collisions };
}

// The `id:` line of an observation's frontmatter, replaced without touching
// anything else in the file. By hand rather than through parse/serialize: a
// conflict copy is whatever the other device wrote, and a rename must not also
// reformat it.
function rewriteIdField(text: string, oldId: string, newId: string): string {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return text;
  const head = m[1].replace(new RegExp(`^id:[ \\t]*${oldId}[ \\t]*$`, "m"), `id: ${newId}`);
  return `---\n${head}\n---\n${text.slice(m[0].length)}`;
}

// --- step 7: the observation ids statements point at ------------------------

// The wrapper key the statement file holds its records under (statements/
// store.ts). Named here rather than imported because that constant is private
// to the store, and this directory is deleted in a later release (after 0.13).
const STATEMENT_CONTAINER = "statements";
// The two fields on a statement that hold observation ids. `supersededBy` is a
// statement id and `evidence` may also hold message anchors, which is why the
// narrow-id regexp decides rather than the field.
const ID_FIELDS = ["evidence", "contradictedBy"] as const;

// Every statement dream wrote before this migration ran names its evidence by
// the narrow observation id, and step 6 has just renamed every one of those
// files. Without this the evidence dangles: nothing resolves, coveredObservation
// Ids matches nothing, and the observations those statements were built from
// come back as candidates on the next night (docs/pitfall/210).
//
// Derived through the same function step 6 renamed the files with, so the two
// agree by construction rather than by having been written to match.
export async function stepWidenStatementIds(fs: MigrationFs): Promise<StepReport> {
  const step = emptyStep("widen-statement-ids", "statements whose ids name an 8 hex observation");
  const text = await fs.read(STATEMENTS_FILE);
  // No statements on this device: nothing to widen, and nothing to report.
  if (text === null || text.trim() === "") return step;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    step.aborted = `${STATEMENTS_FILE} does not parse`;
    refuse(step, STATEMENTS_FILE, "file is not JSON");
    return step;
  }
  const held =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)[STATEMENT_CONTAINER]
      : undefined;
  if (held === undefined) return step;
  if (!Array.isArray(held)) {
    step.aborted = `${STATEMENTS_FILE}: ${STATEMENT_CONTAINER} is not an array`;
    return step;
  }

  let idsWidened = 0;
  for (const record of held) {
    step.scanned++;
    if (typeof record !== "object" || record === null || Array.isArray(record)) {
      refuse(step, `${STATEMENT_CONTAINER}[${step.scanned - 1}]`, "record is not an object");
      continue;
    }
    const statement = record as Record<string, unknown>;
    const id = typeof statement.id === "string" ? statement.id : "?";
    let touched = 0;
    for (const field of ID_FIELDS) {
      const list = statement[field];
      if (!Array.isArray(list)) continue;
      for (let i = 0; i < list.length; i++) {
        const value: unknown = list[i];
        if (typeof value !== "string") continue;
        if (!NARROW_OBSERVATION_ID.test(value)) {
          // Already widened, or a message anchor, which this step has no
          // business touching. Counting it is what makes a second run readable.
          if (WIDE_OBSERVATION_ID.test(value)) {
            step.counts.alreadyWide = (step.counts.alreadyWide ?? 0) + 1;
          }
          continue;
        }
        const next = deriveObservationId(value);
        // Written in place so every field this build does not know — anything a
        // later build adds beside them — rides through untouched.
        list[i] = next;
        touched++;
        idsWidened++;
        sample(step, `${id}: ${field} ${value} -> ${next}`);
      }
    }
    if (touched === 0) step.skipped++;
    else step.changed++;
  }

  step.counts.statementsChanged = step.changed;
  step.counts.idsWidened = idsWidened;
  if (step.changed === 0) return step;
  // The store's own formatting, so a device that has widened and a device that
  // never had a narrow id to widen hold the same bytes.
  await fs.write(STATEMENTS_FILE, JSON.stringify(parsed, null, 2));
  return step;
}

export const STEPS = [
  stepParentAnchors,
  stepTypoAnchors,
  stepMessageIds,
  stepComposeAnchors,
  stepCleanBodies,
  stepWidenObservationIds,
  stepWidenStatementIds,
] as const;
