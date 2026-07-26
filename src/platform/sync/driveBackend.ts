// Google Drive implementation of SyncBackend. All REST calls go through the
// Tauri http plugin (cleanTauriFetch) to bypass the webview's CORS, with the
// access token in the Authorization header and an empty Origin so the plugin
// drops the webview origin (pitfall 15). The capability http scope already
// allows any https host (docs/28), so googleapis.com needs no new entry.
//
// Layout (docs/13): a visible "Reading Partner" folder holding books/ and data/
// subfolders and a manifest.json. Every tracked file is followed by Drive file
// id (stored in sync-state.json), so a user rename in Drive never desyncs it.
// data/ files carry their AppData-relative path as the Drive file name; the name
// is opaque to Drive (slashes are not path separators there). books/<hash>.pdf
// are immutable content-addressed blobs, uploaded once and never overwritten.
//
// A cached id is a guess, not a fact: the file behind it can have been deleted
// or recreated by another device or by the user. Every request made with one
// treats a 404 as "this id is stale" — forget it, find the name again, retry
// once — because otherwise one dead id fails that file on every pass forever
// (docs/pitfall/52).

import { cleanTauriFetch, type TauriFetch } from "../app/tauri-fetch";
import {
  isRetryableFailure,
  RemoteGoneError,
  SyncHttpError,
  SyncTransportError,
  type Manifest,
  type SyncBackend,
} from "./backend";
import type { DriveIds } from "./state";

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

function parseManifest(bytes: Uint8Array): Manifest {
  const text = new TextDecoder().decode(bytes).trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as Manifest;
  } catch {
    return {};
  }
}

interface DriveFile {
  id: string;
  name?: string;
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

  private async patchMedia(
    id: string,
    bytes: Uint8Array,
    what: string,
    policy: Policy = SMALL,
  ): Promise<void> {
    await this.send(
      `${UPLOAD}/files/${id}?uploadType=media`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/octet-stream" },
        body: asBody(bytes),
      },
      what,
      policy,
      async () => undefined,
    );
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

  private async findManifest(): Promise<DriveFile | null> {
    return this.findOne(
      `name='manifest.json' and '${this.ids.folderId}' in parents and trashed=false`,
    );
  }

  // A failed download must propagate. "Empty" here is indistinguishable from
  // "the remote holds nothing", and the engine republishes what it read after
  // the next upload — so one transient failure would rewrite manifest.json with
  // only this device's changed files, and every entry it does not have locally
  // silently drops out of the backup. Unparseable content still degrades to
  // empty: that file cannot be repaired by retrying, and the next upload
  // rebuilds it.
  async listManifest(): Promise<Manifest> {
    const cached = await this.withCachedId(
      this.ids.manifestFileId,
      () => {
        this.ids.manifestFileId = undefined;
      },
      (id) => this.getMedia(id, "manifest download"),
    );
    if (cached.done) return parseManifest(cached.value);

    const found = await this.findManifest();
    if (!found) return {};
    this.ids.manifestFileId = found.id;
    await this.d.persistIds();
    return parseManifest(await this.getMedia(found.id, "manifest download"));
  }

  async writeManifest(manifest: Manifest): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    const cached = await this.withCachedId(
      this.ids.manifestFileId,
      () => {
        this.ids.manifestFileId = undefined;
      },
      (id) => this.patchMedia(id, bytes, "manifest write"),
    );
    if (cached.done) return;

    // Search before creating: the id can be stale while the file is fine (the
    // user emptied their trash on a copy, another device recreated it), and a
    // blind create leaves two manifests and two divergent views of the backup.
    const found = await this.findManifest();
    const id = found ? found.id : await this.createMeta("manifest.json", this.ids.folderId!);
    this.ids.manifestFileId = id;
    await this.d.persistIds();
    await this.patchMedia(id, bytes, "manifest write");
  }

  private async dataFileId(name: string, create: boolean): Promise<string | null> {
    let id = this.ids.fileIds[name];
    if (id) return id;
    const found = await this.findOne(
      `name='${escapeQ(name)}' and '${this.ids.dataFolderId}' in parents and trashed=false`,
    );
    if (found) id = found.id;
    else if (create) id = await this.createMeta(name, this.ids.dataFolderId!);
    else return null;
    this.ids.fileIds[name] = id;
    await this.d.persistIds();
    return id;
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

    const id = await this.dataFileId(name, false);
    if (!id) throw new RemoteGoneError(`Drive file not found: ${name}`);
    return this.getMedia(id, "download");
  }

  async upload(name: string, bytes: Uint8Array): Promise<void> {
    const cached = await this.withCachedId(
      this.ids.fileIds[name],
      () => this.forgetFile(name),
      (id) => this.patchMedia(id, bytes, "upload"),
    );
    if (cached.done) return;

    const id = await this.dataFileId(name, true);
    await this.patchMedia(id!, bytes, "upload");
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
  private async multipartUpload(name: string, bytes: Uint8Array): Promise<string> {
    const boundary = `rp-${crypto.randomUUID()}`;
    const meta = JSON.stringify({ name, parents: [this.ids.booksFolderId] });
    const head = new TextEncoder().encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
        `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
    );
    const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head, 0);
    body.set(bytes, head.length);
    body.set(tail, head.length + bytes.length);
    const data = await this.send(
      `${UPLOAD}/files?uploadType=multipart&fields=id`,
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      },
      "book upload",
      BULK,
      (res) => res.json(),
    );
    return (data as DriveFile).id;
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
