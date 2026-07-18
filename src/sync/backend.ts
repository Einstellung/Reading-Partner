// The narrow storage contract the sync engine depends on. Google Drive is the
// first implementation (driveBackend.ts); the engine never names Drive, so a
// WebDAV or self-hosted backend can slot in later (docs/13).
//
// Two channels:
//   data   — the small JSON/markdown files in the sync range, tracked by their
//            AppData-relative path as the file name, each carrying a manifest
//            entry { rev, mtime, size }.
//   books  — immutable content-addressed PDF blobs (books/<hash>.pdf), written
//            once and never overwritten (uploadBook is a no-op if it exists).

export interface ManifestEntry {
  // Monotonic per-file counter, bumped on every upload; the pull side compares
  // it against the last-synced snapshot to spot remote changes.
  rev: number;
  // Local modification time (epoch ms) of the writer at upload; the tiebreak for
  // last-writer-wins conflicts.
  mtime: number;
  size: number;
}

// Keyed by the AppData-relative path (e.g. "annotations-<id>.json",
// "memory-<topicId>/m-ab12cd34.md").
export type Manifest = Record<string, ManifestEntry>;

export interface SyncBackend {
  // Create the "Reading Partner" folder and its books/ and data/ subfolders if
  // absent, remembering their ids. Idempotent.
  ensureLayout(): Promise<void>;

  listManifest(): Promise<Manifest>;
  writeManifest(manifest: Manifest): Promise<void>;

  download(name: string): Promise<Uint8Array>;
  upload(name: string, bytes: Uint8Array, mtime: number): Promise<void>;

  hasBook(hash: string): Promise<boolean>;
  uploadBook(hash: string, bytes: Uint8Array): Promise<void>;
  downloadBook(hash: string): Promise<Uint8Array>;
}
