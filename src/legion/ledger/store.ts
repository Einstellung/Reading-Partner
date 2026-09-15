// The ledger: `legion/ledger/<YYYY-MM-DD>.jsonl`, one appended line per folded
// run, the day taken from the run's `endedAt` in UTC.
//
// UTC rather than the device's calendar because the day is part of a path two
// devices have to agree on without asking each other, and a laptop in one time
// zone and a phone in another would otherwise write two files for one run.
//
// The file merges as a union of lines (palace "records", shape "lines"), which
// works because a folded line is canonical: the two devices write the same bytes
// for the same run, so the union is one line (fold.ts).
//
// The file system is injected, like the run store and the bell store beside it.

import { appData } from "../../platform/app/appdata";
import { ledgerLineText, parseLedgerLine, type LedgerLine } from "./fold";

export const LEDGER_DIR = "legion/ledger";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What the store needs of a disk. */
export interface LedgerIo {
  /** The file names in the ledger directory. Empty when there is no directory. */
  list(): Promise<string[]>;
  /** A file's text, or null when it is not there. */
  read(name: string): Promise<string | null>;
  write(name: string, contents: string): Promise<void>;
}

/** The day a run folds into: its `endedAt`, in UTC. */
export function ledgerDay(endedAt: number): string {
  return new Date(endedAt).toISOString().slice(0, 10);
}

function fileName(day: string): string {
  return `${day}.jsonl`;
}

function dayOf(name: string): string | null {
  if (!name.endsWith(".jsonl")) return null;
  const day = name.slice(0, -".jsonl".length);
  return DAY.test(day) ? day : null;
}

export interface LedgerStore {
  /**
   * Write one folded run down. A run already in that day's file is left as it
   * is, so a pass that runs twice appends once — and so is the copy the other
   * device folded and sync brought over.
   */
  append(line: LedgerLine): Promise<void>;
  /** One day's lines, oldest file order, one per run. */
  read(day: string): Promise<LedgerLine[]>;
  /** The days that have a file, ascending. */
  days(): Promise<string[]>;
  /** A day's failed runs: the dead-letter view, which has no directory of its own. */
  deadLetters(day: string): Promise<LedgerLine[]>;
}

// What identifies a folded run: the id, and the moment it was created. The id
// alone is not enough — a derived id comes round again when a batch is re-run
// with the same step names, and the two runs are two lines.
function key(line: LedgerLine): string {
  return `${line.id} ${line.createdAt}`;
}

// Two lines under one key are two devices that folded the same run and disagreed
// about something — a brief one of them could not read, and so could not hash.
// The one that knows the hash is the more useful of the two, and after that the
// smaller text, so that every device reduces the pair the same way.
function pick(a: LedgerLine, b: LedgerLine): LedgerLine {
  if ((a.briefHash === null) !== (b.briefHash === null)) return a.briefHash === null ? b : a;
  return ledgerLineText(a) <= ledgerLineText(b) ? a : b;
}

export function createLedgerStore(io: LedgerIo): LedgerStore {
  async function lines(day: string): Promise<LedgerLine[]> {
    const text = await io.read(fileName(day));
    if (text === null) return [];
    const kept = new Map<string, LedgerLine>();
    for (const raw of text.split("\n")) {
      if (raw.trim() === "") continue;
      const line = parseLedgerLine(raw);
      // A line that will not parse is left in the file: it is the only evidence
      // of whatever wrote it, and the file is append-only.
      if (!line) continue;
      const seen = kept.get(key(line));
      kept.set(key(line), seen ? pick(seen, line) : line);
    }
    return [...kept.values()];
  }

  return {
    async append(line) {
      const day = ledgerDay(line.endedAt);
      const text = (await io.read(fileName(day))) ?? "";
      const wanted = ledgerLineText(line);
      for (const raw of text.split("\n")) {
        if (raw.trim() === "") continue;
        if (raw === wanted) return;
        const existing = parseLedgerLine(raw);
        if (existing && key(existing) === key(line)) return;
      }
      await io.write(fileName(day), text === "" ? `${wanted}\n` : `${text}${wanted}\n`);
    },

    read: lines,

    async days() {
      const days: string[] = [];
      for (const name of await io.list()) {
        const day = dayOf(name);
        if (day) days.push(day);
      }
      return days.sort();
    },

    async deadLetters(day) {
      return (await lines(day)).filter((line) => line.state === "failed");
    },
  };
}

/** The ledger directory on this device. */
export const appLedgerIo: LedgerIo = {
  async list() {
    const entries = await appData.readDir(LEDGER_DIR).catch(() => []);
    return entries.filter((e) => e.isFile).map((e) => e.name);
  },
  async read(name) {
    const path = `${LEDGER_DIR}/${name}`;
    if (!(await appData.exists(path))) return null;
    return appData.readText(path).catch(() => null);
  },
  async write(name, contents) {
    await appData.mkdirp(LEDGER_DIR);
    await appData.writeAtomic(`${LEDGER_DIR}/${name}`, contents);
  },
};

let live: LedgerStore | undefined;

/** The ledger this device folds into. */
export function appLedger(): LedgerStore {
  live ??= createLedgerStore(appLedgerIo);
  return live;
}
