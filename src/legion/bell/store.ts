// The bell store: one bell per file under legion/bell/, three actions.
//
// ring writes the whole message before anything is in a state to be read, and
// the state is only ever raised afterwards — that order is what the mailbox
// semantics in docs/55 rest on. A bell is not removed when it is acked; the
// file stays until housekeeping takes it, so a second ring of the same id after
// the ack still finds it and still produces one bell.
//
// Local runtime data, like the session (palace kind "bell", sync "local"): a
// bell is addressed to the soul on this device, and a device that loses the
// folder has lost notifications it can no longer act on, not data.
//
// The file system is injected. The default reads and writes AppData; the tests
// hand in a Map.

import {
  appRecordDirIo,
  readRecords,
  recordFileName,
  type RecordDirIo,
} from "../../platform/app/record-dir";
import {
  BRIEF_MAX,
  bellRank,
  type Bell,
  type BellState,
  type BellType,
  type RingOptions,
  type RingPayload,
} from "./types";

export const BELL_DIR = "legion/bell";

/** What the store needs of a disk. */
export type BellIo = RecordDirIo;

// A bell id has to be a file name, and file names that need escaping are file
// names two ids can collide on. Run and schedule ids are ours, so this is a
// programming error rather than a condition to recover from.
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

export interface BellStore {
  /**
   * Ring one bell. A bell already rung under this id is left as it is — state
   * and all — and handed back, so ringing twice leaves one.
   */
  ring<T extends BellType>(
    type: T,
    payload: RingPayload<T>,
    options?: RingOptions,
  ): Promise<Bell>;
  /** Every bell the soul has not acked, oldest first. The set to recover. */
  read(): Promise<Bell[]>;
  /** The soul has this one written down where a restart will find it. */
  delivered(id: string): Promise<void>;
  /** The soul is done with this one. A run may be folded once this has landed. */
  ack(id: string): Promise<void>;
  /** One bell by id, whatever its state, or null. */
  get(id: string): Promise<Bell | null>;
}

// The default id: the thing the bell is about. Two `run-done` bells for one run
// are one bell; a schedule that fires nightly rings a new bell each time, so its
// id carries the moment it came due.
function defaultId<T extends BellType>(type: T, payload: RingPayload<T>, at: number): string {
  if (type === "wake") return `wake-${(payload as RingPayload<"wake">).scheduleId}-${at}`;
  return `${type}-${(payload as RingPayload<"run-done">).runId}`;
}

function cap(text: string): { text: string; truncated: boolean } {
  if (text.length <= BRIEF_MAX) return { text, truncated: false };
  return { text: text.slice(0, BRIEF_MAX), truncated: true };
}

// The brief is the only field with a size of its own, and both the payloads that
// carry one carry it under the same name.
function fit<T extends BellType>(type: T, payload: RingPayload<T>): Bell["payload"] {
  if (type === "run-failed") return { ...(payload as RingPayload<"run-failed">) };
  const { text, truncated } = cap((payload as unknown as { brief: string }).brief ?? "");
  return {
    ...(payload as object),
    brief: text,
    ...(truncated ? { truncated: true as const } : {}),
  } as Bell["payload"];
}

function parse(text: string, id: string): Bell | null {
  try {
    const value = JSON.parse(text) as Partial<Bell>;
    if (value?.id !== id || typeof value.at !== "number") return null;
    if (value.type !== "run-done" && value.type !== "run-failed" && value.type !== "wake") {
      return null;
    }
    if (bellRank(value.state as BellState) < 0 || typeof value.payload !== "object") return null;
    return value as Bell;
  } catch {
    return null;
  }
}

export function createBellStore(io: BellIo): BellStore {
  // Reading a bell back before raising its state, so the raise is over what is
  // on disk rather than over what this process remembers writing.
  async function get(id: string): Promise<Bell | null> {
    const text = await io.read(recordFileName(id));
    return text === null ? null : parse(text, id);
  }

  async function raise(id: string, state: BellState): Promise<void> {
    const bell = await get(id);
    // A state only goes up. An ack that arrives twice, or an ack that overtook
    // its own delivered, leaves the bell where it already is.
    if (!bell || bellRank(state) <= bellRank(bell.state)) return;
    await io.write(recordFileName(id), JSON.stringify({ ...bell, state }, null, 2));
  }

  return {
    async ring(type, payload, options = {}) {
      const at = options.at ?? Date.now();
      const id = options.id ?? defaultId(type, payload, at);
      if (!ID.test(id)) throw new Error(`bell: "${id}" is not a usable bell id`);
      const already = await get(id);
      if (already) return already;
      const bell = { id, type, at, state: "queued" as const, payload: fit(type, payload) } as Bell;
      await io.write(recordFileName(id), JSON.stringify(bell, null, 2));
      return bell;
    },

    async read() {
      const bells = (await readRecords(io, ID, get)).filter((bell) => bell.state !== "acked");
      bells.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
      return bells;
    },

    delivered: (id) => raise(id, "delivered"),
    ack: (id) => raise(id, "acked"),
    get,
  };
}

/** The bell directory on this device. */
export const appBellIo: BellIo = appRecordDirIo(BELL_DIR);

let live: BellStore | undefined;

/** The store the app rings and the soul answers. */
export function appBells(): BellStore {
  live ??= createBellStore(appBellIo);
  return live;
}
