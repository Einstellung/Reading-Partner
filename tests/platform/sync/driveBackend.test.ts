// The Drive backend's create-vs-reuse decisions (src/platform/sync/driveBackend.ts).
// Every one of these fails silently in production: the app keeps working while a
// second copy of the backup accumulates in Drive, or a blob is marked as backed
// up without ever being uploaded. The failure surfaces on restore day.
//
// The fake below is an in-memory Drive, not a request recorder: it stores files
// with parents and a trashed flag and answers the `q` search the way Drive does,
// so "which file did the backend pick" is observable. No network. Run: bun test.

import { expect, test } from "bun:test";
import { DriveBackend } from "../../../src/platform/sync/driveBackend";
import type { DriveIds } from "../../../src/platform/sync/state";
import type { TauriFetch } from "../../../src/platform/app/tauri-fetch";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

interface FakeFile {
  id: string;
  name: string;
  parents: string[];
  mimeType: string;
  trashed: boolean;
  body: string;
}

interface Seed {
  name: string;
  parents: string[];
  mimeType?: string;
  trashed?: boolean;
  body?: string;
}

function bodyText(body: BodyInit | null | undefined): string {
  if (typeof body === "string") return body;
  if (body instanceof ArrayBuffer) return dec(new Uint8Array(body));
  if (ArrayBuffer.isView(body)) return dec(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  return "";
}

function makeDrive() {
  const files = new Map<string, FakeFile>();
  const requests: { method: string; url: string }[] = [];
  let nextId = 0;
  let pendingSession: { name: string; parents: string[] } | null = null;
  // Set to make one request fail, for the partial-failure cases.
  let failWhen: ((method: string, url: string, body: string) => boolean) | null = null;

  const add = (seed: Seed): string => {
    const id = `id-${++nextId}`;
    files.set(id, {
      id,
      mimeType: "application/octet-stream",
      trashed: false,
      body: "",
      ...seed,
    });
    return id;
  };

  // Drive's `q` grammar, as far as this backend uses it.
  const search = (q: string): FakeFile[] => {
    const name = /name='([^']*)'/.exec(q)?.[1];
    const mimeType = /mimeType='([^']*)'/.exec(q)?.[1];
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    const liveOnly = q.includes("trashed=false");
    return [...files.values()].filter(
      (f) =>
        (name === undefined || f.name === name) &&
        (mimeType === undefined || f.mimeType === mimeType) &&
        (parent === undefined || f.parents.includes(parent)) &&
        (!liveOnly || !f.trashed),
    );
  };

  const json = (value: unknown): Response =>
    new Response(JSON.stringify(value), { status: 200 });

  const fetchImpl: TauriFetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = bodyText(init?.body);
    requests.push({ method, url });
    if (failWhen?.(method, url, body)) return new Response("boom", { status: 500 });

    if (method === "GET" && url.startsWith(`${DRIVE}/files?q=`)) {
      const params = new URL(url).searchParams;
      const size = Number(params.get("pageSize") ?? "100");
      const hits = search(params.get("q") ?? "").slice(0, size);
      return json({ files: hits.map((f) => ({ id: f.id, name: f.name })) });
    }
    if (method === "GET" && url.includes("alt=media")) {
      const id = url.slice(`${DRIVE}/files/`.length).split("?")[0];
      const f = files.get(id);
      if (!f) return new Response("not found", { status: 404 });
      return new Response(f.body, { status: 200 });
    }
    if (method === "POST" && url.startsWith(`${DRIVE}/files?`)) {
      const meta = JSON.parse(body) as Seed;
      return json({ id: add(meta) });
    }
    if (method === "PATCH" && url.startsWith(`${UPLOAD}/files/`)) {
      const id = url.slice(`${UPLOAD}/files/`.length).split("?")[0];
      const f = files.get(id);
      if (!f) return new Response("not found", { status: 404 });
      f.body = body;
      return json({ id });
    }
    if (method === "POST" && url.includes("uploadType=multipart")) {
      const meta = JSON.parse(body.slice(body.indexOf("{"), body.indexOf("}") + 1)) as Seed;
      const mediaStart = body.indexOf("\r\n\r\n", body.indexOf("\r\n\r\n") + 4) + 4;
      return json({ id: add({ ...meta, body: body.slice(mediaStart, body.lastIndexOf("\r\n--")) }) });
    }
    if (method === "POST" && url.includes("uploadType=resumable")) {
      pendingSession = JSON.parse(body) as { name: string; parents: string[] };
      return new Response(null, { status: 200, headers: { Location: `${UPLOAD}/session/1` } });
    }
    if (method === "PUT" && url.startsWith(`${UPLOAD}/session/`)) {
      if (!pendingSession) return new Response("no session", { status: 400 });
      return json({ id: add({ ...pendingSession, body }) });
    }
    throw new Error(`unexpected ${method} ${url}`);
  };

  return {
    fetchImpl,
    requests,
    add,
    byName: (name: string) => [...files.values()].filter((f) => f.name === name),
    one: (name: string) => {
      const hits = [...files.values()].filter((f) => f.name === name);
      expect(hits.length).toBe(1);
      return hits[0];
    },
    reset: () => requests.splice(0, requests.length),
    failOn: (fn: typeof failWhen) => {
      failWhen = fn;
    },
  };
}

type Drive = ReturnType<typeof makeDrive>;

function makeBackend(drive: Drive, ids: Partial<DriveIds> = {}) {
  const full: DriveIds = { fileIds: {}, bookIds: {}, ...ids };
  let persisted = 0;
  const backend = new DriveBackend({
    getToken: async () => "token",
    ids: full,
    persistIds: async () => {
      persisted += 1;
    },
    fetchImpl: drive.fetchImpl,
  });
  return { backend, ids: full, persistCount: () => persisted };
}

// A Drive that already holds the app's folder tree, as every device after the
// first one finds it.
function seedTree(drive: Drive) {
  const folderId = drive.add({ name: "Reading Partner", parents: ["root"], mimeType: FOLDER_MIME });
  const dataFolderId = drive.add({ name: "data", parents: [folderId], mimeType: FOLDER_MIME });
  const booksFolderId = drive.add({ name: "books", parents: [folderId], mimeType: FOLDER_MIME });
  return { folderId, dataFolderId, booksFolderId };
}

const posts = (drive: Drive) => drive.requests.filter((r) => r.method === "POST");

test("ensureLayout adopts the existing Reading Partner tree instead of creating a second one", async () => {
  const drive = makeDrive();
  const seeded = seedTree(drive);
  const { backend, ids, persistCount } = makeBackend(drive);

  await backend.ensureLayout();

  // A create here is the fork: the user ends up with two backups and no error.
  expect(posts(drive)).toEqual([]);
  expect(ids.folderId).toBe(seeded.folderId);
  expect(ids.dataFolderId).toBe(seeded.dataFolderId);
  expect(ids.booksFolderId).toBe(seeded.booksFolderId);
  expect(persistCount()).toBe(1);
});

test("ensureLayout creates the tree once and then stops touching the network", async () => {
  const drive = makeDrive();
  const { backend, ids } = makeBackend(drive);

  await backend.ensureLayout();

  expect(posts(drive).length).toBe(3);
  expect(drive.one("Reading Partner").parents).toEqual(["root"]);
  expect(drive.one("data").parents).toEqual([ids.folderId!]);
  expect(drive.one("books").parents).toEqual([ids.folderId!]);

  drive.reset();
  await backend.ensureLayout();
  expect(drive.requests).toEqual([]);
});

test("ensureLayout ignores a trashed app folder and a same-named folder outside the tree", async () => {
  const drive = makeDrive();
  const trashed = drive.add({
    name: "Reading Partner",
    parents: ["root"],
    mimeType: FOLDER_MIME,
    trashed: true,
  });
  // A "data" folder the user happens to have at the top level of their Drive.
  const decoy = drive.add({ name: "data", parents: ["root"], mimeType: FOLDER_MIME });
  const { backend, ids } = makeBackend(drive);

  await backend.ensureLayout();

  // Adopting the trashed folder would put the whole backup in the trash; adopting
  // the stranger folder would scatter data files outside the app's tree.
  expect(ids.folderId).not.toBe(trashed);
  expect(ids.dataFolderId).not.toBe(decoy);
  expect(drive.byName("data").find((f) => f.id === ids.dataFolderId)!.parents).toEqual([
    ids.folderId!,
  ]);
});

test("an ensureLayout that dies partway leaves no duplicate folder for the next run", async () => {
  const drive = makeDrive();
  drive.failOn((method, _url, body) => method === "POST" && body.includes('"books"'));
  const first = makeBackend(drive);

  await expect(first.backend.ensureLayout()).rejects.toThrow(/Drive create failed/);
  // Nothing was persisted, so a restart here starts from empty ids.
  expect(first.persistCount()).toBe(0);

  drive.failOn(null);
  const second = makeBackend(drive);
  await second.backend.ensureLayout();

  expect(drive.byName("Reading Partner").length).toBe(1);
  expect(drive.byName("data").length).toBe(1);
  expect(drive.byName("books").length).toBe(1);
});

test("listManifest reports an empty remote without creating a manifest", async () => {
  const drive = makeDrive();
  const seeded = seedTree(drive);
  const { backend, ids, persistCount } = makeBackend(drive, { folderId: seeded.folderId });

  expect(await backend.listManifest()).toEqual({});

  // Creating manifest.json on the read path would race writeManifest into two.
  expect(posts(drive)).toEqual([]);
  expect(ids.manifestFileId).toBeUndefined();
  expect(persistCount()).toBe(0);
});

test("listManifest adopts the existing manifest and reuses its id afterwards", async () => {
  const drive = makeDrive();
  const seeded = seedTree(drive);
  const manifestId = drive.add({
    name: "manifest.json",
    parents: [seeded.folderId],
    body: JSON.stringify({ "settings.json": { rev: 4, mtime: 9, size: 2 } }),
  });
  const { backend, ids } = makeBackend(drive, { folderId: seeded.folderId });

  expect(await backend.listManifest()).toEqual({ "settings.json": { rev: 4, mtime: 9, size: 2 } });
  expect(ids.manifestFileId).toBe(manifestId);

  drive.reset();
  await backend.listManifest();
  expect(drive.requests.some((r) => r.url.includes("files?q="))).toBe(false);
});

test("writeManifest creates manifest.json once and patches it from then on", async () => {
  const drive = makeDrive();
  const seeded = seedTree(drive);
  const { backend } = makeBackend(drive, { folderId: seeded.folderId });

  await backend.writeManifest({ a: { rev: 1, mtime: 1, size: 1 } });
  await backend.writeManifest({ a: { rev: 2, mtime: 2, size: 2 } });

  // Two manifests means two divergent views of the backup.
  expect(posts(drive).length).toBe(1);
  expect(JSON.parse(drive.one("manifest.json").body)).toEqual({ a: { rev: 2, mtime: 2, size: 2 } });
});

test("upload adopts the data file another device already created", async () => {
  const drive = makeDrive();
  const seeded = seedTree(drive);
  const existing = drive.add({
    name: "settings.json",
    parents: [seeded.dataFolderId],
    body: "from the other device",
  });
  const { backend, ids } = makeBackend(drive, { dataFolderId: seeded.dataFolderId });

  await backend.upload("settings.json", enc("mine"));

  // Creating a second settings.json splits the file: each device keeps writing
  // its own copy and neither ever sees the other's edits.
  expect(posts(drive)).toEqual([]);
  expect(drive.one("settings.json").body).toBe("mine");
  expect(ids.fileIds["settings.json"]).toBe(existing);
});

test("upload creates a data file once and reuses the id on the next pass", async () => {
  const drive = makeDrive();
  const seeded = seedTree(drive);
  const { backend } = makeBackend(drive, { dataFolderId: seeded.dataFolderId });

  await backend.upload("topics.json", enc("one"));
  drive.reset();
  await backend.upload("topics.json", enc("two"));

  expect(posts(drive)).toEqual([]);
  expect(drive.requests.some((r) => r.url.includes("files?q="))).toBe(false);
  expect(drive.one("topics.json").body).toBe("two");
});

test("a data file duplicated in Drive is adopted, not multiplied", async () => {
  const drive = makeDrive();
  const seeded = seedTree(drive);
  const first = drive.add({ name: "library.json", parents: [seeded.dataFolderId], body: "a" });
  drive.add({ name: "library.json", parents: [seeded.dataFolderId], body: "b" });
  const { backend, ids } = makeBackend(drive, { dataFolderId: seeded.dataFolderId });

  await backend.upload("library.json", enc("c"));

  expect(drive.byName("library.json").length).toBe(2);
  expect(ids.fileIds["library.json"]).toBe(first);
});

test("download of a file that exists nowhere fails loudly", async () => {
  const drive = makeDrive();
  const seeded = seedTree(drive);
  const { backend } = makeBackend(drive, { dataFolderId: seeded.dataFolderId });

  // Returning empty bytes here would have the engine overwrite the local file
  // with nothing.
  await expect(backend.download("annotations-1.json")).rejects.toThrow(
    "Drive file not found: annotations-1.json",
  );
});

test("uploadBook leaves a blob that is already in Drive untouched", async () => {
  const drive = makeDrive();
  const seeded = seedTree(drive);
  const existing = drive.add({
    name: "abc123.pdf",
    parents: [seeded.booksFolderId],
    body: "ORIGINAL",
  });
  const { backend, ids } = makeBackend(drive, { booksFolderId: seeded.booksFolderId });

  await backend.uploadBook("abc123", enc("REUPLOAD"));

  expect(drive.requests.filter((r) => r.method !== "GET")).toEqual([]);
  expect(drive.one("abc123.pdf").body).toBe("ORIGINAL");
  expect(ids.bookIds["abc123"]).toBe(existing);
});

test("a book over the threshold uploads through a resumable session, once", async () => {
  const drive = makeDrive();
  const seeded = seedTree(drive);
  const { backend, ids } = makeBackend(drive, { booksFolderId: seeded.booksFolderId });
  const big = new Uint8Array(5 * 1024 * 1024 + 1).fill(0x41);

  await backend.uploadBook("big", big);

  expect(drive.requests.some((r) => r.url.includes("uploadType=resumable"))).toBe(true);
  expect(drive.requests.some((r) => r.method === "PUT")).toBe(true);
  expect(drive.one("big.pdf").body.length).toBe(big.length);
  expect(ids.bookIds["big"]).toBe(drive.one("big.pdf").id);

  drive.reset();
  await backend.uploadBook("big", big);
  expect(drive.requests).toEqual([]);
});

test("a failed book upload records no id, so the next pass retries it", async () => {
  const drive = makeDrive();
  const seeded = seedTree(drive);
  const { backend, ids } = makeBackend(drive, { booksFolderId: seeded.booksFolderId });
  drive.failOn((_m, url) => url.includes("uploadType=multipart"));

  await expect(backend.uploadBook("small", enc("PDF"))).rejects.toThrow(/Drive book upload failed/);
  // A recorded id here makes hasBook true forever: the blob is never backed up
  // and nothing ever says so.
  expect(ids.bookIds["small"]).toBeUndefined();

  drive.failOn(null);
  await backend.uploadBook("small", enc("PDF"));
  expect(drive.one("small.pdf").body).toBe("PDF");
});

test("downloadBook finds a blob this device has never seen, and fails loudly when absent", async () => {
  const drive = makeDrive();
  const seeded = seedTree(drive);
  const id = drive.add({ name: "seen.pdf", parents: [seeded.booksFolderId], body: "BOOK" });
  const { backend, ids } = makeBackend(drive, { booksFolderId: seeded.booksFolderId });

  expect(dec(await backend.downloadBook("seen"))).toBe("BOOK");
  expect(ids.bookIds["seen"]).toBe(id);
  await expect(backend.downloadBook("gone")).rejects.toThrow("Drive book not found: gone");
});
