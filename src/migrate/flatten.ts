// Step 8: the per-topic observation directories become one flat store.
//
// Every memory-<topicId>/ directory is emptied into observations/ — the entry
// files with the topic stamped into their frontmatter, the tombstones and the
// bookkeeping merged into the store's single copy of each, the derived index
// dropped because the store rebuilds it — and the directory itself is removed
// once nothing is left in it.
//
// Re-runnable, and it has to be: sync propagates no file deletion (docs/13,
// pitfall 208), so a device still on the old build can hand this one a
// memory-<topicId>/ directory back at any time. Running the step again empties
// that one too. Nothing here is keyed on having run before.
//
// A file the step does not recognise is left where it is and reported, and then
// the directory is left as well: an unknown file in there is not observation
// data, and removing the directory around it would take it with it.

import {
  appendTombstone,
  parseObservation,
  parseTombstones,
  serializeObservation,
} from "../memory/observations/files";
import { isLegacyObservationDir } from "../memory/observations/legacy";
import { ObservationFileStore } from "../memory/observations/store";
import { asObservationFs } from "./fs";
import { emptyStep, refuse, sample, type MigrationFs, type StepReport } from "./types";

// Where everything lands. Spelled out rather than imported because the store
// keeps its directory name private, and this whole directory is deleted after
// 0.13.
const DIR = "observations";
const TOMBSTONE_FILE = `${DIR}/deleted-observations.jsonl`;
const META_FILE = `${DIR}/meta.json`;

const ENTRY_FILE = /^m-(?:[0-9a-f]{16}|[0-9a-f]{8})\.md$/;
const CONFLICT_FILE = /^m-(?:[0-9a-f]{16}|[0-9a-f]{8})\.conflict-[0-9a-f]+\.md$/;
const INDEX_FILE = /^index(?:\.conflict-[0-9a-f]+)?\.md$/;
const META_SOURCE = /^meta(?:\.conflict-[0-9a-f]+)?\.json$/;
const TOMBSTONE_SOURCE = /^deleted-observations(?:\.conflict-[0-9a-f]+)?\.jsonl$/;

// meta.json as the flat store holds it (memory/observations/store.ts): the two
// stamps keyed by topic id, the two cursor maps keyed by thread and by book.
interface FlatMeta {
  lastDistilledAt: Record<string, number>;
  lastAnnotationDistillAt: Record<string, number>;
  distilledMessages: Record<string, number>;
  distilledMarks: Record<string, number>;
}

function emptyMeta(): FlatMeta {
  return {
    lastDistilledAt: {},
    lastAnnotationDistillAt: {},
    distilledMessages: {},
    distilledMarks: {},
  };
}

function numbers(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

// Every number in meta.json is a watermark and they are all asymmetric the same
// way (platform/sync/merge/cursors.ts): too high loses material for good, too
// low costs a repeat. Two directories that both name a thread or a book can only
// have got there by sync, and the higher of the two is the one that was actually
// reached — the same rule the merge already applies, so taking the max here
// cannot lose a pass that has run.
function keepHigher(into: Record<string, number>, from: Record<string, number>): void {
  for (const [key, value] of Object.entries(from)) {
    const held = into[key];
    if (held === undefined || value > held) into[key] = value;
  }
}

function readFlatMeta(text: string | null): FlatMeta {
  if (text === null) return emptyMeta();
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      lastDistilledAt: numbers(parsed.lastDistilledAt),
      lastAnnotationDistillAt: numbers(parsed.lastAnnotationDistillAt),
      distilledMessages: numbers(parsed.distilledMessages),
      distilledMarks: numbers(parsed.distilledMarks),
    };
  } catch {
    return emptyMeta();
  }
}

// One directory's meta.json folded into the flat one. The two stamps were
// scalars there and become this topic's slot here; the cursor maps carry over by
// key, which is already global.
function foldMeta(into: FlatMeta, topicId: string, text: string): void {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return;
  }
  const stamp = (field: "lastDistilledAt" | "lastAnnotationDistillAt"): void => {
    const value = parsed[field];
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    const held = into[field][topicId];
    if (held === undefined || value > held) into[field][topicId] = value;
  };
  stamp("lastDistilledAt");
  stamp("lastAnnotationDistillAt");
  keepHigher(into.distilledMessages, numbers(parsed.distilledMessages));
  keepHigher(into.distilledMarks, numbers(parsed.distilledMarks));
}

export async function stepFlattenObservations(fs: MigrationFs): Promise<StepReport> {
  const step = emptyStep("flatten-observations", "observations still in a per-topic directory");
  const dirs = (await fs.listSubdirs("")).filter(isLegacyObservationDir).sort();

  const meta = readFlatMeta(await fs.read(META_FILE));
  let metaSources = 0;
  let tombstoneText = (await fs.read(TOMBSTONE_FILE)) ?? "";
  const tombstoned = parseTombstones(tombstoneText);
  let tombstonesMerged = 0;

  for (const dir of dirs) {
    const topicId = dir.slice("memory-".length);
    let leftover = 0;
    for (const name of (await fs.listDir(dir)).sort()) {
      const path = `${dir}/${name}`;

      if (ENTRY_FILE.test(name)) {
        step.scanned++;
        const text = await fs.read(path);
        const entry = text === null ? null : parseObservation(text);
        if (!entry) {
          refuse(step, path, "file does not parse as an observation");
          leftover++;
          continue;
        }
        const dest = `${DIR}/${name}`;
        // An id is global (m-<16 hex>, step 6), so two directories holding the
        // same name hold the same observation and the one already moved is the
        // one that stays. Reported rather than merged: the two versions are the
        // reader's own record and picking between them is not a migration's
        // call.
        if ((await fs.read(dest)) !== null) {
          refuse(step, path, `${dest} already exists`);
          leftover++;
          continue;
        }
        // The topic the file's own frontmatter already names wins over the
        // directory it sits in: a directory this device pulled in over sync can
        // hold an entry another device had already stamped.
        await fs.write(dest, serializeObservation({ ...entry, topic: entry.topic ?? topicId }));
        await fs.remove(path);
        step.changed++;
        sample(step, `${path} -> ${dest}`);
        continue;
      }

      if (CONFLICT_FILE.test(name)) {
        const text = await fs.read(path);
        if (text === null) continue;
        const dest = `${DIR}/${name}`;
        if ((await fs.read(dest)) !== null) {
          refuse(step, path, `${dest} already exists`);
          leftover++;
          continue;
        }
        // Byte for byte, no topic stamped in. A conflict copy is the whole
        // losing version of what the other device wrote, and the reason to keep
        // it is that it says what that device said.
        await fs.write(dest, text);
        await fs.remove(path);
        step.counts.conflictCopiesMoved = (step.counts.conflictCopiesMoved ?? 0) + 1;
        continue;
      }

      if (INDEX_FILE.test(name)) {
        // Derived, and rebuilt below from the entry files that are now the flat
        // store's. Nothing in a losing copy of it is not in those files.
        await fs.remove(path);
        step.counts.indexesDropped = (step.counts.indexesDropped ?? 0) + 1;
        continue;
      }

      if (META_SOURCE.test(name)) {
        const text = await fs.read(path);
        if (text !== null) {
          // Conflict copies of this file are folded in with everything else,
          // which is the first time anything reads them: they hold cursors the
          // live file never got (cursors.ts names three on the owner's store,
          // carrying 1, 14 and 9 of them), and taking the higher of two
          // watermarks is the same rule the merge would have applied.
          foldMeta(meta, topicId, text);
          metaSources++;
          // Written before the source is removed, not after the loop: a run
          // killed between the two would otherwise take the cursors with it,
          // and the next run would find nothing left to fold in.
          step.counts.metaFilesMerged = metaSources;
          await fs.write(META_FILE, JSON.stringify(meta, null, 2));
        }
        await fs.remove(path);
        continue;
      }

      if (TOMBSTONE_SOURCE.test(name)) {
        const text = await fs.read(path);
        if (text !== null) {
          for (const raw of text.split("\n")) {
            const line = raw.trim();
            if (line === "") continue;
            let record: { id?: unknown; at?: unknown };
            try {
              record = JSON.parse(line) as { id?: unknown; at?: unknown };
            } catch {
              continue;
            }
            if (typeof record.id !== "string" || record.id === "") continue;
            if (tombstoned.has(record.id)) continue;
            tombstoned.add(record.id);
            tombstoneText = appendTombstone(
              tombstoneText,
              record.id,
              typeof record.at === "string" ? record.at : "",
            );
            tombstonesMerged++;
          }
          if (tombstonesMerged > 0) {
            // Same rule as the bookkeeping above: the target is on disk before
            // the source goes.
            step.counts.tombstonesMerged = tombstonesMerged;
            await fs.write(TOMBSTONE_FILE, tombstoneText);
          }
        }
        await fs.remove(path);
        continue;
      }

      refuse(step, path, "not a file this step knows how to move");
      leftover++;
    }

    if (leftover > 0) continue;
    await fs.removeDir(dir);
    step.counts.directoriesRemoved = (step.counts.directoriesRemoved ?? 0) + 1;
  }

  // The index is derived, so the code that owns it writes it. Keyed on the store
  // holding something rather than on this run having moved something: a run
  // killed after the move and before the rebuild leaves entries with no index,
  // and the next run has no directories left to tell it there is work. A store
  // with nothing in it is left alone entirely, so pressing the button on a fresh
  // install writes no files at all.
  if ((await fs.listDir(DIR)).some((name) => ENTRY_FILE.test(name))) {
    await new ObservationFileStore(asObservationFs(fs)).rebuildIndex();
  }
  return step;
}
