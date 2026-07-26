// Google Drive implementation of SyncBackend. All REST calls go through the
// Tauri http plugin (cleanTauriFetch) to bypass the webview's CORS, with the
// access token in the Authorization header and an empty Origin so the plugin
// drops the webview origin (pitfall 15). The capability http scope already
// allows any https host (docs/28), so googleapis.com needs no new entry.
//
// Layout (docs/13): a visible "Reading Partner" folder holding books/ and data/
// subfolders. Every tracked file is followed by Drive file id (stored in
// sync-state.json), so a user rename in Drive never desyncs it. data/ files
// carry their AppData-relative path as the Drive file name; the name is opaque
// to Drive (slashes are not path separators there). books/<hash>.pdf are
// immutable content-addressed blobs, uploaded once and never overwritten.
//
// The remote state is one listing of data/, read from each file's own
// appProperties (rev, mtime, hash — private to this app, 124 bytes per
// key+value, which a rev and a 32-char hash fit inside many times over). There
// used to be a manifest.json over the top of it; it was a lost update every
// time two devices published in the same window, and a single request whose
// failure cost the entire pass. Files uploaded before appProperties are seeded
// from that manifest.json once, on the first pass that sees them — it is left
// in the user's Drive, just no longer maintained.
//
// A cached id is a guess, not a fact: the file behind it can have been deleted
// or recreated by another device or by the user. Every request made with one
// treats a 404 as "this id is stale" — forget it, find the name again, retry
// once — because otherwise one dead id fails that file on every pass forever
// (docs/pitfall/52).

import { cleanTauriFetch, type TauriFetch } from "../app/tauri-fetch";
import {
  isAuthFailure,
  isRetryableFailure,
  RemoteGoneError,
  SyncHttpError,
  SyncTransportError,
  type RemoteEntry,
  type RemoteMeta,
  type RemoteState,
  type SyncBackend,
} from "./backend";
import type { DriveIds } from "./state";
import { inSyncRange } from "./syncFs";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
// Below this, a book is uploaded in a single multipart request; above it, a
// resumable session is used (docs/13). Books are content-addressed and written
// once, so a resumable session is not resumed across restarts here — it is one
// PUT of the whole blob, which the >5MB path exists to keep off the simple
// upload endpoint's size limits.
const RESUMABLE_THRESHOLD = 5 * 1024 * 1024;

// How long to wait for the connection itself. The http plugin passes this to
// reqwest's connect_timeout, which covers only reaching the host — enough to
// stop a blackholed route from hanging a pass, and safe to apply to a 26 MB
// blob whose transfer may legitimately take minutes.
const CONNECT_TIMEOUT_MS = 10_000;

interface Policy {
  attempts: number;
  // Deadline for the whole request including reading the body, enforced with an
  // AbortSignal (the http plugin honours one). null = no deadline.
  timeoutMs: number | null;
}

// Manifest, searches, metadata and data files: all small (the largest data file
// is ~100 KB), so a request still running after this is not going to finish.
const SMALL: Policy = { attempts: 3, timeoutMs: 20_000 };
// Book blobs: no deadline, since a slow link can take minutes to move 26 MB
// legitimately, and one retry only — a repeat costs the whole blob again, and
// the next pass retries anyway.
const BULK: Policy = { attempts: 2, timeoutMs: null };

// Backoff before attempt 2 and attempt 3. Short on purpose: this is a background
// pass on a flaky link, not a queue drain, and the pass itself repeats.
const BACKOFF_MS = [500, 1500];

export interface DriveBackendDeps {
  getToken: () => Promise<string>;
  ids: DriveIds; // mutated in place as folders/files are discovered or created
  persistIds: () => Promise<void>;
  // Injectable for tests; production always uses the Tauri http plugin wrapper.
  fetchImpl?: TauriFetch;
  // Injectable for tests, so retry cases do not cost real seconds.
  sleep?: (ms: number) => Promise<void>;
}

// Escape a value for a Drive `q` search string (single-quoted).
function escapeQ(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// A Uint8Array is a valid fetch body at runtime, but the DOM lib's typed-array
// generics reject it; normalize to the backing ArrayBuffer (zero-copy when the
// view spans its whole buffer, which library reads and our own buffers do).
function asBody(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

// Anything that is not a status: DNS, TLS, a reset connection, a body that
// stopped mid-stream, our own deadline. reqwest's own text ("error sending
// request for url (…)") is kept verbatim — it is the only clue about which
// stage died, and the caller prefixes the file it was working on.
function transportError(
  what: string,
  e: unknown,
  timedOutAfter: number | null,
): SyncTransportError {
  if (timedOutAfter !== null) {
    return new SyncTransportError(`Drive ${what} timed out after ${timedOutAfter}ms`);
  }
  return new SyncTransportError(e instanceof Error ? e.message : String(e));
}

function parseManifest(bytes: Uint8Array): RemoteState {
  const text = new TextDecoder().decode(bytes).trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as RemoteState;
  } catch {
    return {};
  }
}

interface DriveFile {
  id: string;
  name?: string;
  size?: string;
  modifiedTime?: string;
  appProperties?: Record<string, string>;
}

// The listing fields the remote state is built from. `size` and `modifiedTime`
// are Drive's own; rev/mtime/hash are ours.
const LIST_FIELDS = "nextPageToken,files(id,name,size,modifiedTime,appProperties)";
// Drive's maximum. One request covers a data folder many times the size of any
// real one, so the page loop is a formality rather than a cost.
const PAGE_SIZE = 1000;

function numberProp(props: Record<string, string> | undefined, key: string): number | null {
  const raw = props?.[key];
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Drive's own write time, the fallback for a file that never recorded the
// writer's local mtime.
function driveMtime(f: DriveFile): number {
  const t = Date.parse(f.modifiedTime ?? "");
  return Number.isFinite(t) ? t : 0;
}

// What one listed file says about itself, or null when it predates
// appProperties and has to be seeded from the old manifest.json.
function entryOf(f: DriveFile): RemoteEntry | null {
  const rev = numberProp(f.appProperties, "rev");
  if (rev === null) return null;
  return {
    rev,
    mtime: numberProp(f.appProperties, "mtime") ?? driveMtime(f),
    size: Number(f.size ?? 0),
    hash: f.appProperties?.hash,
  };
}

function propsOf(meta: RemoteMeta): Record<string, string> {
  return { rev: String(meta.rev), mtime: String(meta.mtime), hash: meta.hash };
}

export class DriveBackend implements SyncBackend {
  constructor(private readonly d: DriveBackendDeps) {}

  private get ids(): DriveIds {
    return this.d.ids;
  }

  // One request, retried while the failure is the kind a retry can fix. Every
  // attempt gets a fresh token and a fresh deadline; the body is read inside the
  // attempt, so a stream that dies halfway is retried like any other transport
  // failure instead of surfacing as truncated bytes.
  private async send<T>(
    url: string,
    init: RequestInit | undefined,
    what: string,
    policy: Policy,
    read: (res: Response) => Promise<T>,
  ): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < policy.attempts; attempt++) {
      if (attempt > 0) {
        await (this.d.sleep ?? sleep)(BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]);
      }
      try {
        return await this.once(url, init, what, policy, read);
      } catch (e) {
        // A dead refresh token, a 404, a 403 quota denial: asking again changes
        // nothing, and the caller has to see it as it is.
        if (!isRetryableFailure(e) || attempt === policy.attempts - 1) throw e;
        last = e;
      }
    }
    throw last;
  }

  private async once<T>(
    url: string,
    init: RequestInit | undefined,
    what: string,
    policy: Policy,
    read: (res: Response) => Promise<T>,
  ): Promise<T> {
    // Outside the try: a GoogleAuthError is not a transport failure and must
    // reach the engine untouched, which uses it to drop to signed-out.
    const token = await this.d.getToken();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Origin", "");
    const controller = policy.timeoutMs === null ? null : new AbortController();
    const timer =
      controller === null ? null : setTimeout(() => controller.abort(), policy.timeoutMs!);
    const timedOut = (): boolean => controller?.signal.aborted === true;
    try {
      let res: Response;
      try {
        res = await (this.d.fetchImpl ?? cleanTauriFetch)(url, {
          ...init,
          headers,
          signal: controller?.signal,
          connectTimeout: CONNECT_TIMEOUT_MS,
        });
      } catch (e) {
        throw transportError(what, e, timedOut() ? policy.timeoutMs : null);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new SyncHttpError(
          res.status,
          `Drive ${what} failed (HTTP ${res.status}): ${body.slice(0, 300)}`,
        );
      }
      try {
        return await read(res);
      } catch (e) {
        throw transportError(what, e, timedOut() ? policy.timeoutMs : null);
      }
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  private async findOne(q: string): Promise<DriveFile | null> {
    const url = `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive&pageSize=1`;
    const data = await this.send(url, undefined, "search", SMALL, (res) => res.json());
    const files = (data as { files?: DriveFile[] }).files;
    return files && files.length > 0 ? files[0] : null;
  }

  private async createMeta(name: string, parentId: string, mimeType?: string): Promise<string> {
    const body: Record<string, unknown> = { name, parents: [parentId] };
    if (mimeType) body.mimeType = mimeType;
    const data = await this.send(
      `${DRIVE}/files?fields=id`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      "create",
      SMALL,
      (res) => res.json(),
    );
    return (data as DriveFile).id;
  }

  // Metadata only, no media: the endpoint that seeds appProperties onto a file
  // whose bytes are already right.
  private async patchMeta(id: string, body: Record<string, unknown>): Promise<void> {
    await this.send(
      `${DRIVE}/files/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      "properties",
      SMALL,
      async () => undefined,
    );
  }

  // One multipart/related request carrying metadata and media together.
  // uploadType=media cannot carry metadata at all, and two requests can leave a
  // file whose bytes and whose description disagree.
  private async multipartWrite(
    url: string,
    method: "POST" | "PATCH",
    meta: Record<string, unknown>,
    bytes: Uint8Array,
    contentType: string,
    what: string,
    policy: Policy,
  ): Promise<string> {
    const boundary = `rp-${crypto.randomUUID()}`;
    const head = new TextEncoder().encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
        `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    );
    const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head, 0);
    body.set(bytes, head.length);
    body.set(tail, head.length + bytes.length);
    const data = await this.send(
      url,
      {
        method,
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      },
      what,
      policy,
      (res) => res.json(),
    );
    return (data as DriveFile).id;
  }

  private async getMedia(id: string, what: string, policy: Policy = SMALL): Promise<Uint8Array> {
    return this.send(
      `${DRIVE}/files/${id}?alt=media`,
      undefined,
      what,
      policy,
      async (res) => new Uint8Array(await res.arrayBuffer()),
    );
  }

  // Run `attempt` with a cached id; on a 404 the id is stale, so forget it and
  // hand back null for the caller to resolve the name afresh.
  private async withCachedId<T>(
    cached: string | undefined,
    forget: () => void,
    attempt: (id: string) => Promise<T>,
  ): Promise<{ done: true; value: T } | { done: false }> {
    if (!cached) return { done: false };
    try {
      return { done: true, value: await attempt(cached) };
    } catch (e) {
      if (!(e instanceof SyncHttpError) || e.status !== 404) throw e;
      forget();
      await this.d.persistIds();
      return { done: false };
    }
  }

  private async findOrCreateFolder(name: string, parentId: string): Promise<string> {
    const found = await this.findOne(
      `mimeType='${FOLDER_MIME}' and name='${escapeQ(name)}' and '${parentId}' in parents and trashed=false`,
    );
    return found ? found.id : await this.createMeta(name, parentId, FOLDER_MIME);
  }

  async ensureLayout(): Promise<void> {
    let changed = false;
    if (!this.ids.folderId) {
      this.ids.folderId = await this.findOrCreateFolder("Reading Partner", "root");
      changed = true;
    }
    if (!this.ids.dataFolderId) {
      this.ids.dataFolderId = await this.findOrCreateFolder("data", this.ids.folderId);
      changed = true;
    }
    if (!this.ids.booksFolderId) {
      this.ids.booksFolderId = await this.findOrCreateFolder("books", this.ids.folderId);
      changed = true;
    }
    if (changed) await this.d.persistIds();
  }

  // Every live file in data/, one page at a time.
  private async listDataFiles(): Promise<DriveFile[]> {
    const q = `'${this.ids.dataFolderId}' in parents and trashed=false`;
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const url =
        `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(LIST_FIELDS)}` +
        `&spaces=drive&pageSize=${PAGE_SIZE}` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
      const data = (await this.send(url, undefined, "list", SMALL, (res) => res.json())) as {
        files?: DriveFile[];
        nextPageToken?: string;
      };
      for (const f of data.files ?? []) if (f.name) out.push(f);
      pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
  }

  // The whole remote state from one listing. Names outside the sync range are
  // ignored: the folder is the user's, and something they dropped in it is not
  // an instruction to write it into their AppData.
  async listRemote(): Promise<RemoteState> {
    const files = await this.listDataFiles();
    const out: RemoteState = {};
    const unseeded: DriveFile[] = [];
    // Two files under one name is a Drive the app is not supposed to produce
    // but can find; the first listed wins, so which one is chosen at least does
    // not change from pass to pass.
    const seen = new Set<string>();
    let learnedIds = false;

    for (const f of files) {
      const name = f.name!;
      if (!inSyncRange(name) || seen.has(name)) continue;
      seen.add(name);
      if (this.ids.fileIds[name] !== f.id) {
        this.ids.fileIds[name] = f.id;
        learnedIds = true;
      }
      const entry = entryOf(f);
      if (entry) out[name] = entry;
      else unseeded.push(f);
    }
    if (learnedIds) await this.d.persistIds();

    if (unseeded.length > 0) await this.seedFromManifest(unseeded, out);
    return out;
  }

  // Files uploaded before appProperties existed. Their rev lives in the old
  // manifest.json, which is read once and copied onto them; from then on the
  // listing answers for itself and this request never happens again. The
  // manifest is not deleted — it is the user's file, and a device still on the
  // old build reads it.
  //
  // A failed read propagates rather than degrading to "no revs": every other
  // device's changes would look like nothing had happened, and this device
  // would quietly stop pulling them.
  private async seedFromManifest(unseeded: DriveFile[], out: RemoteState): Promise<void> {
    const legacy = await this.readManifest();
    for (const f of unseeded) {
      const name = f.name!;
      // rev 0 for a file the manifest never named: a device that has never seen
      // it still pulls it, and reconcile publishes above its own snapshot, so
      // an unknown rev cannot be mistaken for a fresh one.
      out[name] = legacy[name] ?? { rev: 0, mtime: driveMtime(f), size: Number(f.size ?? 0) };
    }

    let streak = 0;
    for (const f of unseeded) {
      const e = out[f.name!]!;
      try {
        // No hash: the only way to learn one is to download the file, and
        // fifty downloads is exactly what a migration must not cost. It gets
        // one on its next upload.
        await this.patchMeta(f.id, {
          appProperties: { rev: String(e.rev), mtime: String(e.mtime) },
        });
        streak = 0;
      } catch (err) {
        if (isAuthFailure(err)) throw err;
        // Best effort: the in-memory state above is already correct, and the
        // next pass seeds whatever is left. A run of failures means the link is
        // down, not that these files are special.
        if ((streak += 1) >= 3) return;
      }
    }
  }

  private async readManifest(): Promise<RemoteState> {
    const cached = await this.withCachedId(
      this.ids.manifestFileId,
      () => {
        this.ids.manifestFileId = undefined;
      },
      (id) => this.getMedia(id, "manifest download"),
    );
    if (cached.done) return parseManifest(cached.value);

    const found = await this.findOne(
      `name='manifest.json' and '${this.ids.folderId}' in parents and trashed=false`,
    );
    if (!found) return {};
    this.ids.manifestFileId = found.id;
    await this.d.persistIds();
    return parseManifest(await this.getMedia(found.id, "manifest download"));
  }

  private async findDataFile(name: string): Promise<DriveFile | null> {
    return this.findOne(
      `name='${escapeQ(name)}' and '${this.ids.dataFolderId}' in parents and trashed=false`,
    );
  }

  private forgetFile(name: string): void {
    delete this.ids.fileIds[name];
  }

  async download(name: string): Promise<Uint8Array> {
    const cached = await this.withCachedId(
      this.ids.fileIds[name],
      () => this.forgetFile(name),
      (id) => this.getMedia(id, "download"),
    );
    if (cached.done) return cached.value;

    const found = await this.findDataFile(name);
    if (!found) throw new RemoteGoneError(`Drive file not found: ${name}`);
    this.ids.fileIds[name] = found.id;
    await this.d.persistIds();
    return this.getMedia(found.id, "download");
  }

  // Bytes and metadata in one request, so the rev that describes them can never
  // be published for content that did not land.
  async upload(name: string, bytes: Uint8Array, meta: RemoteMeta): Promise<void> {
    const write = (id: string): Promise<string> =>
      this.multipartWrite(
        `${UPLOAD}/files/${id}?uploadType=multipart&fields=id`,
        "PATCH",
        { appProperties: propsOf(meta) },
        bytes,
        "application/octet-stream",
        "upload",
        SMALL,
      );

    const cached = await this.withCachedId(
      this.ids.fileIds[name],
      () => this.forgetFile(name),
      write,
    );
    if (cached.done) return;

    // Search before creating: the id can be stale while the file is fine (the
    // user emptied their trash on a copy, another device recreated it), and a
    // blind create leaves two files under one name and two divergent histories.
    const found = await this.findDataFile(name);
    const id = found
      ? await write(found.id)
      : await this.multipartWrite(
          `${UPLOAD}/files?uploadType=multipart&fields=id`,
          "POST",
          { name, parents: [this.ids.dataFolderId], appProperties: propsOf(meta) },
          bytes,
          "application/octet-stream",
          "upload",
          SMALL,
        );
    this.ids.fileIds[name] = id;
    await this.d.persistIds();
  }

  private async findBook(hash: string): Promise<DriveFile | null> {
    return this.findOne(
      `name='${escapeQ(hash)}.pdf' and '${this.ids.booksFolderId}' in parents and trashed=false`,
    );
  }

  async hasBook(hash: string): Promise<boolean> {
    if (this.ids.bookIds[hash]) return true;
    const found = await this.findBook(hash);
    if (!found) return false;
    this.ids.bookIds[hash] = found.id;
    await this.d.persistIds();
    return true;
  }

  async uploadBook(hash: string, bytes: Uint8Array): Promise<void> {
    if (await this.hasBook(hash)) return; // immutable blob, never overwritten
    const name = `${hash}.pdf`;
    const id =
      bytes.length > RESUMABLE_THRESHOLD
        ? await this.resumableUpload(name, bytes)
        : await this.multipartUpload(name, bytes);
    this.ids.bookIds[hash] = id;
    await this.d.persistIds();
  }

  async downloadBook(hash: string): Promise<Uint8Array> {
    const cached = await this.withCachedId(
      this.ids.bookIds[hash],
      () => {
        delete this.ids.bookIds[hash];
      },
      (id) => this.getMedia(id, "book download", BULK),
    );
    if (cached.done) return cached.value;

    const found = await this.findBook(hash);
    if (!found) throw new RemoteGoneError(`Drive book not found: ${hash}`);
    this.ids.bookIds[hash] = found.id;
    await this.d.persistIds();
    return this.getMedia(found.id, "book download", BULK);
  }

  // Small book: one multipart/related request carrying metadata + media.
  private multipartUpload(name: string, bytes: Uint8Array): Promise<string> {
    return this.multipartWrite(
      `${UPLOAD}/files?uploadType=multipart&fields=id`,
      "POST",
      { name, parents: [this.ids.booksFolderId] },
      bytes,
      "application/pdf",
      "book upload",
      BULK,
    );
  }

  // Large book: open a resumable session, then PUT the whole blob to it.
  private async resumableUpload(name: string, bytes: Uint8Array): Promise<string> {
    const location = await this.send(
      `${UPLOAD}/files?uploadType=resumable&fields=id`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": "application/pdf",
          "X-Upload-Content-Length": String(bytes.length),
        },
        body: JSON.stringify({ name, parents: [this.ids.booksFolderId] }),
      },
      "book session",
      SMALL,
      async (res) => res.headers.get("Location") ?? res.headers.get("location"),
    );
    if (!location) throw new Error("Drive resumable session returned no Location");
    const data = await this.send(
      location,
      {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: asBody(bytes),
      },
      "book put",
      BULK,
      (res) => res.json(),
    );
    return (data as DriveFile).id;
  }
}
