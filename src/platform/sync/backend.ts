// The narrow storage contract the sync engine depends on. Google Drive is the
// first implementation (driveBackend.ts); the engine never names Drive, so a
// WebDAV or self-hosted backend can slot in later (docs/13).
//
// Two channels:
//   data   — the small JSON/markdown files in the sync range, tracked by their
//            AppData-relative path as the file name, each carrying its own
//            { rev, mtime, size, hash }.
//   books  — immutable content-addressed PDF blobs (books/<hash>.pdf), written
//            once and never overwritten (uploadBook is a no-op if it exists).
//
// A file's own metadata is the record, with no index file over the top: an
// index two devices both rewrite is a lost update waiting to happen, and one
// that fails to load takes the whole pass with it.

// What the backend is told to record with an upload.
export interface RemoteMeta {
  rev: number;
  mtime: number;
  hash: string;
}

export interface RemoteEntry {
  // Monotonic per-file counter, bumped on every upload; the pull side compares
  // it against the last-synced snapshot to spot remote changes.
  rev: number;
  // Local modification time (epoch ms) of the writer at upload. Informational
  // since conflicts stopped being decided by a clock.
  mtime: number;
  size: number;
  // Content hash of the bytes (content.ts). Optional because a file uploaded
  // before hashing has none: an absent hash costs the "both sides already hold
  // the same bytes" shortcut, nothing else.
  hash?: string;
}

// Keyed by the AppData-relative path (e.g. "annotations-<id>.json",
// "memory-<topicId>/m-ab12cd34.md").
export type RemoteState = Record<string, RemoteEntry>;

// --- how a failure is classified ------------------------------------------
//
// Three kinds of failure have to be told apart in code, never by matching
// message text: a request that never completed (retry it), a status the server
// chose (retry only 429/5xx), and a file that is simply not in the remote any
// more (no retry will produce it — skip the item).

// The request never reached a response: DNS, TLS, a reset connection, our own
// timeout. reqwest reports these through the http plugin as "error sending
// request for url (…)", which carries no status at all.
export class SyncTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncTransportError";
  }
}

// The server answered with a status the request cannot be considered done at.
export class SyncHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SyncHttpError";
    this.status = status;
  }
}

// The named file is gone from the remote (or was never there). A pass skips the
// item rather than counting it as a fault: retrying cannot bring it back, and
// treating it as a fault would keep lastSyncAt pinned forever over a condition
// nothing can fix.
export class RemoteGoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteGoneError";
  }
}

// 408/429 and the 5xx family are the server asking to be asked again; every
// other status is an answer, and repeating the request just repeats it.
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export function isRetryableFailure(e: unknown): boolean {
  if (e instanceof SyncTransportError) return true;
  return e instanceof SyncHttpError && RETRYABLE_STATUS.has(e.status);
}

export function isRemoteGone(e: unknown): boolean {
  return e instanceof RemoteGoneError;
}

// A dead refresh token, as opposed to an ordinary (offline) failure. The auth
// module throws GoogleAuthError; nothing here takes a dependency on it, so it
// is matched structurally by the thrown error's name.
export function isAuthFailure(e: unknown): boolean {
  return e instanceof Error && e.name === "GoogleAuthError";
}

export interface SyncBackend {
  // Create the "Reading Partner" folder and its books/ and data/ subfolders if
  // absent, remembering their ids. Idempotent.
  ensureLayout(): Promise<void>;

  // Everything the data folder holds, from its own metadata.
  listRemote(): Promise<RemoteState>;

  // Throws RemoteGoneError when the name is not in the remote any more.
  download(name: string): Promise<Uint8Array>;
  // Writes the bytes and the metadata that describes them together, so a rev is
  // never published for content that did not land.
  upload(name: string, bytes: Uint8Array, meta: RemoteMeta): Promise<void>;

  hasBook(hash: string): Promise<boolean>;
  uploadBook(hash: string, bytes: Uint8Array): Promise<void>;
  // Throws RemoteGoneError when the blob is not in the remote any more.
  downloadBook(hash: string): Promise<Uint8Array>;
}
