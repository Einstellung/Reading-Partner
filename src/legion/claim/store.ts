// The claim files: one per device under `legion/claim/`, named after the device
// that writes it.
//
// One writer each and no merge (palace kind "claim", strategy opaque), which is
// what a crossing pair should leave behind — a copy nobody reads. They travel on
// the data channel: a claim is only worth anything to the other machines.
//
// The file system is injected, as the bell store's is. The default reads and
// writes AppData; tests hand in a Map.

import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import type { DeviceClaim } from "./types";

export const CLAIM_DIR = "legion/claim";

const JSON_SUFFIX = ".json";

export function claimFile(deviceId: string): string {
  return `${CLAIM_DIR}/${deviceId}${JSON_SUFFIX}`;
}

/** What the store needs of a disk. */
export interface ClaimIo {
  /** The file names in the claim directory. Empty when there is no directory. */
  list(): Promise<string[]>;
  /** A file's text, or null when it is not there. */
  read(name: string): Promise<string | null>;
  write(name: string, contents: string): Promise<void>;
}

export const appClaimIo: ClaimIo = {
  async list() {
    const entries = await appData.readDir(CLAIM_DIR).catch(() => []);
    return entries.filter((e) => e.isFile).map((e) => e.name);
  },
  async read(name) {
    const path = `${CLAIM_DIR}/${name}`;
    try {
      if (!(await appData.exists(path))) return null;
      return await appData.readText(path);
    } catch {
      return null;
    }
  },
  async write(name, contents) {
    await appData.mkdirp(CLAIM_DIR);
    // Through the atomic writer rather than appData directly: a claim is a
    // synced file, and the write listeners are how it leaves this machine.
    await writeTextAtomic(`${CLAIM_DIR}/${name}`, contents);
  },
};

// A claim carries whatever the domain that wrote it put there, so this checks
// only what legion itself reads. Anything else rides along untouched.
function isClaim(value: unknown): value is DeviceClaim {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<DeviceClaim>;
  return typeof v.deviceId === "string" && typeof v.heartbeatAt === "number";
}

// A claim written by an older build has no capability list. Reading it as an
// empty one is the honest answer: a machine that never said what it can do is
// not a candidate for work that needs anything.
function withCapabilities<T extends DeviceClaim>(claim: DeviceClaim): T {
  return (Array.isArray(claim.capabilities) ? claim : { ...claim, capabilities: [] }) as T;
}

export interface ClaimStore {
  /**
   * Every device's claim, this one's included. A device that has never seen
   * another gets a list of one, or an empty list before it has written its own.
   */
  readAll<T extends DeviceClaim = DeviceClaim>(): Promise<T[]>;
  /** This device's own claim, for the fields that survive a restart. */
  readOwn<T extends DeviceClaim = DeviceClaim>(deviceId: string): Promise<T | null>;
  write(claim: DeviceClaim): Promise<void>;
}

export function createClaimStore(io: ClaimIo): ClaimStore {
  return {
    async readAll<T extends DeviceClaim = DeviceClaim>(): Promise<T[]> {
      const names = (await io.list().catch(() => [])).filter((n) => n.endsWith(JSON_SUFFIX));
      const out: T[] = [];
      for (const name of names) {
        const text = await io.read(name).catch(() => null);
        if (text === null) continue;
        try {
          const parsed: unknown = JSON.parse(text);
          if (isClaim(parsed)) out.push(withCapabilities<T>(parsed));
        } catch {
          // A half-written or hand-edited file is one device's opinion missing,
          // not a reason to stop reading the others.
        }
      }
      return out;
    },

    async readOwn<T extends DeviceClaim = DeviceClaim>(deviceId: string): Promise<T | null> {
      const text = await io.read(`${deviceId}${JSON_SUFFIX}`).catch(() => null);
      if (text === null) return null;
      try {
        const parsed: unknown = JSON.parse(text);
        return isClaim(parsed) ? withCapabilities<T>(parsed) : null;
      } catch {
        return null;
      }
    },

    write(claim: DeviceClaim): Promise<void> {
      return io.write(`${claim.deviceId}${JSON_SUFFIX}`, JSON.stringify(claim, null, 2));
    },
  };
}

let live: ClaimStore | undefined;

/** The store this device writes its claim to and reads the others from. */
export function appClaims(): ClaimStore {
  live ??= createClaimStore(appClaimIo);
  return live;
}
