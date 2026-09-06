// The layout observations used to live in, and how to tell it is still there.
//
// Before the flattening there was one directory per topic — memory-<topicId>/ —
// holding that topic's entry files, its derived index, its tombstones and its
// bookkeeping. Everything now sits in one observations/ directory with the topic
// as a field on the record (store.ts), and the 0.12 migration's last step moves
// what is left (migrate/steps.ts).
//
// Two callers ask the same question of this module and must get the same answer:
// the migration button, which offers the move, and the nightly dream pass, which
// stands down until it has happened. A night that read a half-moved store would
// write statements whose evidence names files that are about to be somewhere
// else, which is the shape of what 0.12 already did once (docs/pitfall/210).
//
// Pure but for the two listings, so both callers can be tested headless.

// A per-topic observation directory. The suffix is a topic id and is never
// empty, so "memory-" on its own is not one.
const LEGACY_DIR = /^memory-.+$/;

// The files the move knows what to do with: entry files and their conflict
// copies at either id width, the derived index, the tombstone log and the
// bookkeeping, each with the conflict copies sync may have parked beside it.
//
// Deliberately not "any file at all". Anything else in one of those directories
// is not observation data, the move leaves it alone, and a gate that counted it
// would hold the nightly pass shut for good over a file nothing reads.
const LEGACY_FILE =
  /^(?:m-[0-9a-f]{8}(?:[0-9a-f]{8})?(?:\.conflict-[0-9a-f]+)?\.md|index(?:\.conflict-[0-9a-f]+)?\.md|meta(?:\.conflict-[0-9a-f]+)?\.json|deleted-observations(?:\.conflict-[0-9a-f]+)?\.jsonl)$/;

export function isLegacyObservationDir(name: string): boolean {
  return LEGACY_DIR.test(name);
}

export function isLegacyObservationFile(name: string): boolean {
  return LEGACY_FILE.test(name);
}

// What the question needs of a filesystem: the directories under the app data
// root, and the file names in one of them.
export interface LegacyLayoutFs {
  listSubdirs(path: string): Promise<string[]>;
  listDir(path: string): Promise<string[]>;
}

// The per-topic directories that still hold something the move would take.
export async function legacyObservationDirs(fs: LegacyLayoutFs): Promise<string[]> {
  const out: string[] = [];
  for (const name of (await fs.listSubdirs("")).filter(isLegacyObservationDir).sort()) {
    if ((await fs.listDir(name)).some(isLegacyObservationFile)) out.push(name);
  }
  return out;
}

// Whether any of them does. Asks the files rather than a stored flag on purpose:
// the migration keeps no applied-state (migrate/types.ts), and a flag that
// synced over from the device that ran it would say "done" on a device whose own
// files never moved. The same reason holds after the move — sync can hand this
// device a memory-<topicId>/ directory from a machine still on the old build at
// any time, and then the answer is true again and the move runs again.
export async function legacyObservationLayout(fs: LegacyLayoutFs): Promise<boolean> {
  for (const name of (await fs.listSubdirs("")).filter(isLegacyObservationDir)) {
    if ((await fs.listDir(name)).some(isLegacyObservationFile)) return true;
  }
  return false;
}
