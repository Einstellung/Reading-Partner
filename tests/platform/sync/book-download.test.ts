// A book downloaded in ranged GETs (src/platform/sync/driveBackend.ts
// rangedBook): chunk by chunk, resumed from the last good offset when a chunk
// gives up, and falling back to one whole-body GET when the server ignores
// Range. The fake below serves byte ranges the way Drive does and records every
// Range header it was sent. No network.

import { expect, test } from "bun:test";
import { DriveBackend, parseContentRange } from "../../../src/platform/sync/driveBackend";
import { SyncTransportError } from "../../../src/platform/sync/backend";
import type { DriveIds } from "../../../src/platform/sync/state";
import type { TauriFetch } from "../../../src/platform/app/tauri-fetch";

const BOOKS = "books-folder";

function blob(length: number, seed = 7): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed;
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x & 0xff;
  }
  return out;
}

const body = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

interface Sent {
  id: string;
  range: string | null;
}

// Blobs by Drive id, and which hash names which id for the search.
function makeServer() {
  const blobs = new Map<string, Uint8Array>();
  const names = new Map<string, string>();
  const sent: Sent[] = [];
  let ignoreRange = false;
  // Decides, per media request, whether it dies before an answer.
  let dropWhen: ((s: Sent) => boolean) | null = null;
  // Decides whether a 206 comes back with fewer bytes than its header claims.
  let truncateWhen: ((s: Sent) => boolean) | null = null;

  const fetchImpl: TauriFetch = async (input, init) => {
    const url = String(input);
    const search = /name%3D'([^']+)\.pdf'|name='([^']+)\.pdf'/.exec(decodeURIComponent(url));
    if (url.includes("/files?q=")) {
      const hash = search?.[1] ?? search?.[2];
      const id = hash ? names.get(hash) : undefined;
      return new Response(JSON.stringify({ files: id ? [{ id, name: `${hash}.pdf` }] : [] }));
    }
    const media = /\/files\/([^?]+)\?alt=media/.exec(url);
    if (!media) return new Response("unexpected", { status: 500 });
    const id = media[1]!;
    const range = new Headers(init?.headers).get("Range");
    const s: Sent = { id, range };
    sent.push(s);
    if (dropWhen?.(s)) throw new Error("error sending request for url");
    const bytes = blobs.get(id);
    if (!bytes) return new Response("not found", { status: 404 });
    const asked = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
    if (!asked || ignoreRange) return new Response(body(bytes), { status: 200 });
    const start = Number(asked[1]);
    if (start >= bytes.length) return new Response("", { status: 416 });
    const end = Math.min(Number(asked[2]), bytes.length - 1);
    const part = bytes.subarray(start, end + 1);
    return new Response(body(truncateWhen?.(s) ? part.subarray(0, part.length - 1) : part), {
      status: 206,
      headers: { "Content-Range": `bytes ${start}-${end}/${bytes.length}` },
    });
  };

  return {
    fetchImpl,
    sent,
    put(hash: string, id: string, bytes: Uint8Array) {
      blobs.set(id, bytes);
      names.set(hash, id);
    },
    remove(id: string) {
      blobs.delete(id);
    },
    ignoreRange(on: boolean) {
      ignoreRange = on;
    },
    dropOn(f: ((s: Sent) => boolean) | null) {
      dropWhen = f;
    },
    truncateOn(f: ((s: Sent) => boolean) | null) {
      truncateWhen = f;
    },
    ranges: (from = 0) => sent.slice(from).map((s) => s.range),
  };
}

function makeBackend(server: ReturnType<typeof makeServer>, bookIds: Record<string, string> = {}) {
  const ids: DriveIds = { booksFolderId: BOOKS, fileIds: {}, bookIds: { ...bookIds } };
  const slept: number[] = [];
  const backend = new DriveBackend({
    getToken: async () => "token",
    ids,
    persistIds: async () => {},
    fetchImpl: server.fetchImpl,
    sleep: async (ms) => {
      slept.push(ms);
    },
    downloadChunkBytes: 256,
  });
  return { backend, ids, slept };
}

function recorder() {
  const seen: [number, number][] = [];
  return { seen, on: (received: number, total: number) => seen.push([received, total]) };
}

test("a book comes down in ranged chunks, byte for byte, with progress after each", async () => {
  const server = makeServer();
  const book = blob(700);
  server.put("h1", "id-1", book);
  const { backend } = makeBackend(server, { h1: "id-1" });
  const progress = recorder();

  const got = await backend.downloadBook("h1", progress.on);

  expect(got).toEqual(book);
  expect(server.ranges()).toEqual(["bytes=0-255", "bytes=256-511", "bytes=512-699"]);
  expect(progress.seen).toEqual([
    [256, 700],
    [512, 700],
    [700, 700],
  ]);
});

test("a chunk that drops once is asked for again from its own start, not from zero", async () => {
  const server = makeServer();
  const book = blob(600);
  server.put("h1", "id-1", book);
  const { backend, slept } = makeBackend(server, { h1: "id-1" });
  let dropped = false;
  server.dropOn((s) => {
    if (dropped || s.range !== "bytes=256-511") return false;
    dropped = true;
    return true;
  });

  expect(await backend.downloadBook("h1")).toEqual(book);
  expect(server.ranges()).toEqual([
    "bytes=0-255",
    "bytes=256-511",
    "bytes=256-511",
    "bytes=512-599",
  ]);
  expect(slept).toEqual([500]);
});

test("a download that gives up keeps its bytes, and the next ask continues from the offset", async () => {
  const server = makeServer();
  const book = blob(1000);
  server.put("h1", "id-1", book);
  const { backend } = makeBackend(server, { h1: "id-1" });
  server.dropOn((s) => s.range === "bytes=512-767");
  const first = recorder();

  await expect(backend.downloadBook("h1", first.on)).rejects.toBeInstanceOf(SyncTransportError);
  // Three attempts at the chunk that kept dropping, none at the ones before it.
  expect(server.ranges()).toEqual([
    "bytes=0-255",
    "bytes=256-511",
    "bytes=512-767",
    "bytes=512-767",
    "bytes=512-767",
  ]);
  expect(first.seen).toEqual([
    [256, 1000],
    [512, 1000],
  ]);

  server.dropOn(null);
  const before = server.sent.length;
  const second = recorder();
  const got = await backend.downloadBook("h1", second.on);

  expect(got).toEqual(book);
  expect(server.ranges(before)).toEqual(["bytes=512-767", "bytes=768-999"]);
  // Where it stood is said at once, before the first new byte lands.
  expect(second.seen).toEqual([
    [512, 1000],
    [768, 1000],
    [1000, 1000],
  ]);
});

test("a server that ignores Range gets one whole-body GET instead", async () => {
  const server = makeServer();
  const book = blob(700);
  server.put("h1", "id-1", book);
  server.ignoreRange(true);
  const { backend } = makeBackend(server, { h1: "id-1" });
  const progress = recorder();

  expect(await backend.downloadBook("h1", progress.on)).toEqual(book);
  // The ranged ask answered 200 and was not read; the plain one carries the book.
  expect(server.ranges()).toEqual(["bytes=0-255", null]);
  expect(progress.seen).toEqual([[700, 700]]);
});

test("a server that stops honouring Range partway does not mix its whole body with the held bytes", async () => {
  const server = makeServer();
  const book = blob(900);
  server.put("h1", "id-1", book);
  const { backend } = makeBackend(server, { h1: "id-1" });
  server.dropOn((s) => s.range === "bytes=256-511");
  await expect(backend.downloadBook("h1")).rejects.toBeInstanceOf(SyncTransportError);

  server.dropOn(null);
  server.ignoreRange(true);
  const before = server.sent.length;
  expect(await backend.downloadBook("h1")).toEqual(book);
  expect(server.ranges(before)).toEqual(["bytes=256-511", null]);
});

test("an empty book, which no range can satisfy, comes down through the whole-body GET", async () => {
  const server = makeServer();
  server.put("h1", "id-1", new Uint8Array(0));
  const { backend } = makeBackend(server, { h1: "id-1" });

  expect((await backend.downloadBook("h1")).length).toBe(0);
  expect(server.ranges()).toEqual(["bytes=0-255", null]);
});

test("a stale book id is forgotten and the blob found by name, in chunks", async () => {
  const server = makeServer();
  const book = blob(400);
  server.put("h1", "id-real", book);
  const { backend, ids } = makeBackend(server, { h1: "id-ghost" });

  expect(await backend.downloadBook("h1")).toEqual(book);
  expect(ids.bookIds["h1"]).toBe("id-real");
  expect(server.sent.map((s) => `${s.id} ${s.range}`)).toEqual([
    "id-ghost bytes=0-255",
    "id-real bytes=0-255",
    "id-real bytes=256-399",
  ]);
});

test("held bytes are dropped when the book's id changes under them", async () => {
  const server = makeServer();
  const book = blob(800);
  server.put("h1", "id-old", book);
  const { backend, ids } = makeBackend(server, { h1: "id-old" });
  server.dropOn((s) => s.range === "bytes=512-767");
  await expect(backend.downloadBook("h1")).rejects.toBeInstanceOf(SyncTransportError);

  // Another device deleted the blob and uploaded the book again.
  server.dropOn(null);
  server.remove("id-old");
  server.put("h1", "id-new", book);
  const before = server.sent.length;
  expect(await backend.downloadBook("h1")).toEqual(book);
  expect(ids.bookIds["h1"]).toBe("id-new");
  expect(server.sent.slice(before).map((s) => `${s.id} ${s.range}`)).toEqual([
    "id-old bytes=512-767",
    "id-new bytes=0-255",
    "id-new bytes=256-511",
    "id-new bytes=512-767",
    "id-new bytes=768-799",
  ]);
});

test("held bytes are dropped when the remote size changes under them", async () => {
  const server = makeServer();
  server.put("h1", "id-1", blob(800, 1));
  const { backend } = makeBackend(server, { h1: "id-1" });
  server.dropOn((s) => s.range === "bytes=256-511");
  await expect(backend.downloadBook("h1")).rejects.toBeInstanceOf(SyncTransportError);

  server.dropOn(null);
  const replaced = blob(600, 2);
  server.put("h1", "id-1", replaced);
  const before = server.sent.length;
  expect(await backend.downloadBook("h1")).toEqual(replaced);
  expect(server.ranges(before)).toEqual([
    "bytes=256-511",
    "bytes=0-255",
    "bytes=256-511",
    "bytes=512-599",
  ]);
});

test("a deleted book's held bytes are dropped, so asking again starts from zero", async () => {
  const server = makeServer();
  const book = blob(600);
  server.put("h1", "id-1", book);
  const { backend } = makeBackend(server, { h1: "id-1" });
  server.dropOn((s) => s.range === "bytes=256-511");
  await expect(backend.downloadBook("h1")).rejects.toBeInstanceOf(SyncTransportError);

  backend.dropPartialBook("h1");
  server.dropOn(null);
  const before = server.sent.length;
  expect(await backend.downloadBook("h1")).toEqual(book);
  expect(server.ranges(before)[0]).toBe("bytes=0-255");
});

test("a download of another book in between drops the first one's held bytes", async () => {
  const server = makeServer();
  const a = blob(600, 3);
  const b = blob(300, 4);
  server.put("ha", "id-a", a);
  server.put("hb", "id-b", b);
  const { backend } = makeBackend(server, { ha: "id-a", hb: "id-b" });
  server.dropOn((s) => s.id === "id-a" && s.range === "bytes=256-511");
  await expect(backend.downloadBook("ha")).rejects.toBeInstanceOf(SyncTransportError);

  server.dropOn(null);
  expect(await backend.downloadBook("hb")).toEqual(b);
  const before = server.sent.length;
  expect(await backend.downloadBook("ha")).toEqual(a);
  expect(server.ranges(before)[0]).toBe("bytes=0-255");
});

test("a 206 whose body is shorter than its Content-Range is retried, not placed", async () => {
  const server = makeServer();
  const book = blob(500);
  server.put("h1", "id-1", book);
  const { backend } = makeBackend(server, { h1: "id-1" });
  let once = false;
  server.truncateOn((s) => {
    if (once || s.range !== "bytes=256-499") return false;
    once = true;
    return true;
  });

  expect(await backend.downloadBook("h1")).toEqual(book);
  expect(server.ranges()).toEqual(["bytes=0-255", "bytes=256-499", "bytes=256-499"]);
});

test("Content-Range is read only when it names a whole known range", () => {
  expect(parseContentRange("bytes 0-255/700")).toEqual({ start: 0, end: 255, total: 700 });
  expect(parseContentRange("bytes 0-255/*")).toBeNull();
  expect(parseContentRange("bytes */700")).toBeNull();
  expect(parseContentRange("bytes 300-255/700")).toBeNull();
  expect(parseContentRange("bytes 0-700/700")).toBeNull();
  expect(parseContentRange(null)).toBeNull();
});
