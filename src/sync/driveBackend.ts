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

import { cleanTauriFetch } from "../app/tauri-fetch";
import type { Manifest, SyncBackend } from "./backend";
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

export interface DriveBackendDeps {
  getToken: () => Promise<string>;
  ids: DriveIds; // mutated in place as folders/files are discovered or created
  persistIds: () => Promise<void>;
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

interface DriveFile {
  id: string;
  name?: string;
}

export class DriveBackend implements SyncBackend {
  constructor(private readonly d: DriveBackendDeps) {}

  private get ids(): DriveIds {
    return this.d.ids;
  }

  private async authed(url: string, init?: RequestInit): Promise<Response> {
    const token = await this.d.getToken();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Origin", "");
    return cleanTauriFetch(url, { ...init, headers });
  }

  private async ok(res: Response, what: string): Promise<Response> {
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Drive ${what} failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
    }
    return res;
  }

  private async findOne(q: string): Promise<DriveFile | null> {
    const url = `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive&pageSize=1`;
    const res = await this.ok(await this.authed(url), "search");
    const data = (await res.json()) as { files?: DriveFile[] };
    return data.files && data.files.length > 0 ? data.files[0] : null;
  }

  private async createMeta(name: string, parentId: string, mimeType?: string): Promise<string> {
    const body: Record<string, unknown> = { name, parents: [parentId] };
    if (mimeType) body.mimeType = mimeType;
    const res = await this.ok(
      await this.authed(`${DRIVE}/files?fields=id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      "create",
    );
    return ((await res.json()) as DriveFile).id;
  }

  private async patchMedia(id: string, bytes: Uint8Array): Promise<void> {
    await this.ok(
      await this.authed(`${UPLOAD}/files/${id}?uploadType=media`, {
        method: "PATCH",
        headers: { "Content-Type": "application/octet-stream" },
        body: asBody(bytes),
      }),
      "upload media",
    );
  }

  private async getMedia(id: string): Promise<Uint8Array> {
    const res = await this.ok(await this.authed(`${DRIVE}/files/${id}?alt=media`), "download");
    return new Uint8Array(await res.arrayBuffer());
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

  async listManifest(): Promise<Manifest> {
    let id = this.ids.manifestFileId;
    if (!id) {
      const found = await this.findOne(
        `name='manifest.json' and '${this.ids.folderId}' in parents and trashed=false`,
      );
      if (!found) return {};
      id = found.id;
      this.ids.manifestFileId = id;
      await this.d.persistIds();
    }
    try {
      const bytes = await this.getMedia(id);
      const text = new TextDecoder().decode(bytes).trim();
      return text ? (JSON.parse(text) as Manifest) : {};
    } catch {
      return {};
    }
  }

  async writeManifest(manifest: Manifest): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    if (!this.ids.manifestFileId) {
      this.ids.manifestFileId = await this.createMeta("manifest.json", this.ids.folderId!);
      await this.d.persistIds();
    }
    await this.patchMedia(this.ids.manifestFileId, bytes);
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

  async download(name: string): Promise<Uint8Array> {
    const id = await this.dataFileId(name, false);
    if (!id) throw new Error(`Drive file not found: ${name}`);
    return this.getMedia(id);
  }

  async upload(name: string, bytes: Uint8Array): Promise<void> {
    const id = await this.dataFileId(name, true);
    await this.patchMedia(id!, bytes);
  }

  async hasBook(hash: string): Promise<boolean> {
    if (this.ids.bookIds[hash]) return true;
    const found = await this.findOne(
      `name='${escapeQ(hash)}.pdf' and '${this.ids.booksFolderId}' in parents and trashed=false`,
    );
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
    let id = this.ids.bookIds[hash];
    if (!id) {
      const found = await this.findOne(
        `name='${escapeQ(hash)}.pdf' and '${this.ids.booksFolderId}' in parents and trashed=false`,
      );
      if (!found) throw new Error(`Drive book not found: ${hash}`);
      id = found.id;
      this.ids.bookIds[hash] = id;
      await this.d.persistIds();
    }
    return this.getMedia(id);
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
    const res = await this.ok(
      await this.authed(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      }),
      "book upload",
    );
    return ((await res.json()) as DriveFile).id;
  }

  // Large book: open a resumable session, then PUT the whole blob to it.
  private async resumableUpload(name: string, bytes: Uint8Array): Promise<string> {
    const init = await this.ok(
      await this.authed(`${UPLOAD}/files?uploadType=resumable&fields=id`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": "application/pdf",
          "X-Upload-Content-Length": String(bytes.length),
        },
        body: JSON.stringify({ name, parents: [this.ids.booksFolderId] }),
      }),
      "book session",
    );
    const location = init.headers.get("Location") ?? init.headers.get("location");
    if (!location) throw new Error("Drive resumable session returned no Location");
    const res = await this.ok(
      await this.authed(location, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: asBody(bytes),
      }),
      "book put",
    );
    return ((await res.json()) as DriveFile).id;
  }
}
