// What one device holds, as a tree snapshot it publishes for the others
// (docs/59). One file per device, written by that device alone and never
// merged — the same shape as info-collector-<id>.json, and deliberately not the
// single global index that driveBackend.ts already had to take apart.
//
//   Drive: data/holdings-<deviceId>.json   what I hold, for the others to read
//   local: sync-holdings/self.json         the copy I last published
//          sync-holdings/<deviceId>.json   the peer holdings I last reasoned from
//
// It sits in data/, so the one listing a pass already makes enumerates every
// device's copy: noticing that a peer's tree moved costs no request at all. It
// is not in the sync range (syncFs.ts) and listRemote picks it out by name, so
// reconcile never sees one and nothing ever writes one into AppData.
//
// The local copies sit beside sync-base/, outside the range for the same reason
// the base mirror is: they are this device's bookkeeping about the sync.
//
// What a holdings answers is "what did this device hold", which is a different
// question from "what is in the remote now" — so there is no rev in it. The
// listing's appProperties answer that one, and mixing the two would make "I
// hold it but the upload never landed" indistinguishable from "I do not hold
// it".
//
// Pure: no IO, no imports outside this module's own types. The store that puts
// these bytes on disk is in localStore.ts.

// The prefix a holdings file carries in the remote. Chosen so one listing
// separates them from data by name alone.
const REMOTE_PREFIX = "holdings-";
const REMOTE_SUFFIX = ".json";

// The local directory of cached holdings, and the name the self copy takes in
// it. "self" cannot collide with a device id: ids are generated with a "d-"
// prefix (platform/app/device.ts).
export const HOLDINGS_DIR = "sync-holdings";
export const SELF_KEY = "self";

// A device id, as it may appear inside a path or a remote name. A holdings file
// name arrives from the remote, and the device id in it becomes a local path,
// so it is checked rather than trusted — the same rule syncFs.ts states for
// every other id that crosses that line.
const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isDeviceId(id: string): boolean {
  return DEVICE_ID.test(id);
}

export function holdingsRemoteName(deviceId: string): string {
  return `${REMOTE_PREFIX}${deviceId}${REMOTE_SUFFIX}`;
}

/** The device a remote name belongs to, or null when the name is not one. */
export function holdingsDeviceOf(name: string): string | null {
  if (!name.startsWith(REMOTE_PREFIX) || !name.endsWith(REMOTE_SUFFIX)) return null;
  const id = name.slice(REMOTE_PREFIX.length, name.length - REMOTE_SUFFIX.length);
  return isDeviceId(id) ? id : null;
}

/** Whether a remote name is a holdings file of any device. */
export function isHoldingsName(name: string): boolean {
  return holdingsDeviceOf(name) !== null;
}

/** The local path a cached copy takes. `key` is SELF_KEY or a device id. */
export function holdingsPath(key: string): string {
  return `${HOLDINGS_DIR}/${key}.json`;
}

// path -> [contentHash, size]. The hash is the one the pass already computed
// (content.ts); size is there to make the file readable by a human looking at
// two devices that disagree, and is never compared.
export type HoldingsFiles = Record<string, [string, number]>;

export interface Holdings {
  v: 1;
  device: string;
  at: number;
  // The app version, when the caller has one to hand. Display only.
  app?: string;
  // Whether the scan behind this was complete (fs.list() returned normally). A
  // false one is shown but never reasoned from: absences in a partial scan are
  // not deletions.
  complete: boolean;
  files: HoldingsFiles;
  // Paths that left the sync range in this build (docs/59 §8.7). A peer seeing
  // one stops syncing it and never deletes its local copy: a range that
  // narrowed is not the user deleting anything.
  retired: string[];
}

export interface HoldingsStore {
  // The cached bytes for a key (SELF_KEY or a device id), or null.
  read(key: string): Promise<Uint8Array | null>;
  write(key: string, bytes: Uint8Array): Promise<void>;
}

export function buildHoldings(input: {
  device: string;
  at: number;
  files: HoldingsFiles;
  app?: string;
  complete?: boolean;
  retired?: readonly string[];
}): Holdings {
  return {
    v: 1,
    device: input.device,
    at: input.at,
    ...(input.app ? { app: input.app } : {}),
    complete: input.complete ?? true,
    files: sortFiles(input.files),
    retired: [...(input.retired ?? [])].sort(),
  };
}

function sortFiles(files: HoldingsFiles): HoldingsFiles {
  const out: HoldingsFiles = {};
  for (const path of Object.keys(files).sort()) out[path] = files[path];
  return out;
}

// Two devices that hold the same tree must write the same bytes, so nothing
// here may depend on the order a scan happened to produce: the keys are sorted
// and the fields are written in a fixed order. That is also what makes "did my
// tree change" a byte comparison rather than a diff.
export function serializeHoldings(h: Holdings): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(buildHoldings(h), null, 2)}\n`);
}

/** null for anything that is not a v1 holdings — a truncated file, another
 * build's format, a file the user dropped in the folder. */
export function parseHoldings(bytes: Uint8Array | null): Holdings | null {
  if (bytes === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Partial<Holdings>;
  if (o.v !== 1 || typeof o.device !== "string" || typeof o.files !== "object" || !o.files) {
    return null;
  }
  const files: HoldingsFiles = {};
  for (const [path, entry] of Object.entries(o.files)) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || typeof entry[1] !== "number") {
      continue;
    }
    files[path] = [entry[0], entry[1]];
  }
  return {
    v: 1,
    device: o.device,
    at: typeof o.at === "number" ? o.at : 0,
    ...(typeof o.app === "string" ? { app: o.app } : {}),
    // Absent reads as complete: only a build that knows about partial scans
    // writes the field, and one that does not never published a partial tree.
    complete: o.complete !== false,
    files,
    retired: Array.isArray(o.retired) ? o.retired.filter((p) => typeof p === "string") : [],
  };
}

/** Whether two trees name the same paths with the same hashes. What decides
 * whether this device publishes again — everything else in the file (`at`
 * above all) would make an idle pass an upload. */
export function sameFiles(a: HoldingsFiles, b: HoldingsFiles): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const path of ka) {
    const x = a[path];
    const y = b[path];
    if (!y || x[0] !== y[0] || x[1] !== y[1]) return false;
  }
  return true;
}

// --- diagnostics ------------------------------------------------------------

// What one pass did with holdings, for the report below. Two devices that
// disagree are diagnosed from this and nothing else: without it a wrong
// deletion on real hardware has no way to be attributed.
export interface HoldingsPass {
  // What this device holds, whether or not it was published this pass.
  self: Holdings | null;
  published: boolean;
  peers: {
    device: string;
    // What the pass reasoned from and what it reasoned about; either can be
    // absent (nothing cached yet, or the download failed).
    cached: Holdings | null;
    current: Holdings | null;
  }[];
  // How many peer trees this pass actually fetched: a peer whose rev did not
  // move is reasoned about from the cached copy and costs no request.
  fetched: number;
  // Paths the inference concluded are deleted, and paths where a delete met a
  // local edit and the edit won.
  inferred: string[];
  contested: string[];
  // Whether the inference was allowed to run at all (infer-deletions.ts).
  enabled: boolean;
}

export function emptyHoldingsPass(): HoldingsPass {
  return {
    self: null,
    published: false,
    peers: [],
    fetched: 0,
    inferred: [],
    contested: [],
    enabled: false,
  };
}

/** The whole holdings state of one pass as text, for a debug surface or a log
 * line. Pure, so a test pins it. */
export function renderHoldingsPass(pass: HoldingsPass): string {
  const lines: string[] = [];
  const self = pass.self;
  lines.push(
    self
      ? `self ${self.device} at=${self.at} files=${Object.keys(self.files).length}` +
        `${self.complete ? "" : " partial"}${pass.published ? " (published)" : ""}`
      : "self: not published (no device id)",
  );
  if (pass.peers.length === 0) lines.push("peers: none");
  for (const p of pass.peers) {
    const shape = (h: Holdings | null): string =>
      h ? `at=${h.at} files=${Object.keys(h.files).length}${h.complete ? "" : " partial"}` : "none";
    lines.push(`peer ${p.device} cached[${shape(p.cached)}] now[${shape(p.current)}]`);
  }
  lines.push(
    `inferred deletions (${pass.enabled ? "on" : "off"}): ` +
      (pass.inferred.length === 0 ? "none" : pass.inferred.join(", ")),
  );
  if (pass.contested.length > 0) lines.push(`contested: ${pass.contested.join(", ")}`);
  return lines.join("\n");
}

/** The one-line summary a pass logs. */
export function summariseHoldingsPass(pass: HoldingsPass): string {
  return (
    `sync holdings: published=${pass.published ? 1 : 0} peers=${pass.peers.length} ` +
    `fetched=${pass.fetched} inferred=${pass.inferred.length} ` +
    `contested=${pass.contested.length}`
  );
}
