// A book downloaded in ranged GETs (src/platform/sync/driveBackend.ts
// rangedBook): the first chunk alone, then the rest four at a time into their
// own slots of one buffer, resumed by the chunks still missing when one gives
// up, and falling back to one whole-body GET when the server ignores Range. The
// fake below serves byte ranges the way Drive does, can hold each answer back
// for a while so chunks finish out of order, and records every Range header it
// was sent and how many requests it was serving at once. No network.

import { expect, test } from "bun:test";
import { DriveBackend, parseContentRange } from "../../../src/platform/sync/driveBackend";
import { SyncTransportError } from "../../../src/platform/sync/backend";
import type { DriveIds } from "../../../src/platform/sync/state";
import type { TauriFetch } from "../../../src/platform/app/tauri-fetch";

const BOOKS = "books-folder";
const CHUNK = 256;

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
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// The Range header of chunk `i` of a book `total` bytes long.
function chunkRange(i: number, total: number): string {
  return `bytes=${i * CHUNK}-${Math.min((i + 1) * CHUNK, total) - 1}`;
}
const chunkRanges = (indices: number[], total: number) => indices.map((i) => chunkRange(i, total));
const allChunks = (total: number) =>
  chunkRanges(
    Array.from({ length: Math.ceil(total / CHUNK) }, (_, i) => i),
    total,
  );
const sorted = (xs: (string | null)[]) => [...xs].sort();
const last = <T>(xs: T[]): T | undefined => xs[xs.length - 1];

interface Sent {
  id: string;
  range: string | null;
  // Requests already being served when this one arrived.
  busy: number;
}

// Blobs by Drive id, and which hash names which id for the search.
function makeServer() {
  const blobs = new Map<string, Uint8Array>();
  const names = new Map<string, string>();
  const sent: Sent[] = [];
  // Ranges answered with a good 206, in the order they were answered.
  const answered: string[] = [];
  let inFlight = 0;
  let peak = 0;
  // Decides, per media request, whether it answers 200 with the whole blob.
  let ignoreWhen: ((s: Sent) => boolean) | null = null;
  // Decides, per media request, whether it dies before an answer.
  let dropWhen: ((s: Sent) => boolean) | null = null;
  // Decides whether a 206 comes back with fewer bytes than its header claims.
  let truncateWhen: ((s: Sent) => boolean) | null = null;
  // Decides whether a 206 answers a shorter range than was asked for.
  let shortWhen: ((s: Sent) => boolean) | null = null;
  // How long, in ms, a media request is held before it is answered.
  let delayOf: ((s: Sent) => number) | null = null;

  const serve = async (s: Sent): Promise<Response> => {
    const ms = delayOf?.(s) ?? 0;
    if (ms > 0) await wait(ms);
    if (dropWhen?.(s)) throw new Error("error sending request for url");
    const bytes = blobs.get(s.id);
    if (!bytes) return new Response("not found", { status: 404 });
    const asked = /^bytes=(\d+)-(\d+)$/.exec(s.range ?? "");
    if (!asked || ignoreWhen?.(s)) return new Response(body(bytes), { status: 200 });
    const start = Number(asked[1]);
    if (start >= bytes.length) return new Response("", { status: 416 });
    let end = Math.min(Number(asked[2]), bytes.length - 1);
    if (shortWhen?.(s)) end -= 1;
    const part = bytes.subarray(start, end + 1);
    const truncated = truncateWhen?.(s) ?? false;
    if (!truncated && !shortWhen?.(s)) answered.push(s.range!);
    return new Response(body(truncated ? part.subarray(0, part.length - 1) : part), {
      status: 206,
      headers: { "Content-Range": `bytes ${start}-${end}/${bytes.length}` },
    });
  };

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
    const s: Sent = { id: media[1]!, range: new Headers(init?.headers).get("Range"), busy: inFlight };
    sent.push(s);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      return await serve(s);
    } finally {
      inFlight -= 1;
    }
  };

  return {
    fetchImpl,
    sent,
    answered,
    peak: () => peak,
    inFlight: () => inFlight,
    put(hash: string, id: string, bytes: Uint8Array) {
      blobs.set(id, bytes);
      names.set(hash, id);
    },
    remove(id: string) {
      blobs.delete(id);
    },
    ignoreRange(on: boolean) {
      ignoreWhen = on ? () => true : null;
    },
    ignoreOn(f: ((s: Sent) => boolean) | null) {
      ignoreWhen = f;
    },
    dropOn(f: ((s: Sent) => boolean) | null) {
      dropWhen = f;
    },
    truncateOn(f: ((s: Sent) => boolean) | null) {
      truncateWhen = f;
    },
    shortOn(f: ((s: Sent) => boolean) | null) {
      shortWhen = f;
    },
    delayOn(f: ((s: Sent) => number) | null) {
      delayOf = f;
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
    downloadChunkBytes: CHUNK,
  });
  return { backend, ids, slept };
}

function recorder() {
  const seen: [number, number][] = [];
  return { seen, on: (received: number, total: number) => seen.push([received, total]) };
}

// Received never goes back, never passes the total, and reaches it only once,
// as the last call.
function expectSaneProgress(seen: [number, number][], total: number) {
  for (let i = 0; i < seen.length; i++) {
    const [received, of] = seen[i]!;
    expect(of).toBe(total);
    expect(received).toBeLessThanOrEqual(total);
    if (i > 0) expect(received).toBeGreaterThanOrEqual(seen[i - 1]![0]);
    if (i < seen.length - 1) expect(received).toBeLessThan(total);
  }
  expect(seen[seen.length - 1]).toEqual([total, total]);
}

// Which chunk a Range header names.
const indexOf = (range: string | null) => Number(/^bytes=(\d+)-/.exec(range ?? "")![1]) / CHUNK;

test("a book comes down byte for byte when its chunks land out of order", async () => {
  const server = makeServer();
  const total = 10 * CHUNK + 100;
  const book = blob(total);
  server.put("h1", "id-1", book);
  // Later chunks answer sooner, so the last ones land first.
  server.delayOn((s) => (s.range === "bytes=0-255" ? 0 : 2 + (11 - indexOf(s.range)) * 3));
  const { backend } = makeBackend(server, { h1: "id-1" });
  const progress = recorder();

  const got = await backend.downloadBook("h1", progress.on);

  expect(got).toEqual(book);
  // The first chunk is asked for alone, to learn the size; each chunk once.
  expect(server.ranges()[0]).toBe("bytes=0-255");
  expect(server.sent[1]!.busy).toBe(0);
  expect(sorted(server.ranges())).toEqual(sorted(allChunks(total)));
  const order = server.answered.map(indexOf);
  expect(order).not.toEqual([...order].sort((a, b) => a - b));
  expect(progress.seen.length).toBe(11);
  expectSaneProgress(progress.seen, total);
});

test("no more than four chunks are in flight at once", async () => {
  const server = makeServer();
  const total = 12 * CHUNK;
  const book = blob(total);
  server.put("h1", "id-1", book);
  server.delayOn((s) => 3 + (indexOf(s.range) % 3) * 2);
  const { backend } = makeBackend(server, { h1: "id-1" });

  expect(await backend.downloadBook("h1")).toEqual(book);
  expect(server.peak()).toBe(4);
  expect(server.sent.length).toBe(12);
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
  expect(sorted(server.ranges())).toEqual(
    sorted(["bytes=0-255", "bytes=256-511", "bytes=256-511", "bytes=512-599"]),
  );
  expect(slept).toEqual([500]);
});

test("a chunk that gives up stops new chunks, keeps the finished ones, and the next ask fetches only the missing", async () => {
  const server = makeServer();
  const total = 10 * CHUNK;
  const book = blob(total);
  server.put("h1", "id-1", book);
  const { backend } = makeBackend(server, { h1: "id-1" });
  // Chunk 2 fails at once, three times, while 1, 3 and 4 are still on the wire.
  server.dropOn((s) => s.range === chunkRange(2, total));
  server.delayOn((s) => (s.range === chunkRange(2, total) || s.range === "bytes=0-255" ? 0 : 20));
  const first = recorder();

  await expect(backend.downloadBook("h1", first.on)).rejects.toBeInstanceOf(SyncTransportError);
  // Nothing was still writing when the error came out.
  expect(server.inFlight()).toBe(0);
  // Three attempts at chunk 2; nothing past the chunks already in flight.
  expect(sorted(server.ranges())).toEqual(sorted(chunkRanges([0, 1, 2, 2, 2, 3, 4], total)));
  expect(last(first.seen)).toEqual([4 * CHUNK, total]);

  server.dropOn(null);
  server.delayOn(null);
  const before = server.sent.length;
  const second = recorder();
  const got = await backend.downloadBook("h1", second.on);

  expect(got).toEqual(book);
  expect(sorted(server.ranges(before))).toEqual(sorted(chunkRanges([2, 5, 6, 7, 8, 9], total)));
  // Where it stood is said at once, before the first new byte lands.
  expect(second.seen[0]).toEqual([4 * CHUNK, total]);
  expectSaneProgress(second.seen, total);

  // A finished download holds nothing: asking again starts from zero.
  const after = server.sent.length;
  expect(await backend.downloadBook("h1")).toEqual(book);
  expect(server.ranges(after)[0]).toBe("bytes=0-255");
  expect(server.ranges(after).length).toBe(10);
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

test("a 200 midway waits for the chunks in flight, then takes the whole body alone", async () => {
  const server = makeServer();
  const total = 10 * CHUNK;
  const book = blob(total);
  server.put("h1", "id-1", book);
  const { backend } = makeBackend(server, { h1: "id-1" });
  server.ignoreOn((s) => s.range === chunkRange(3, total));
  server.delayOn((s) => (s.range === chunkRange(3, total) || s.range === "bytes=0-255" ? 0 : 15));
  const progress = recorder();

  expect(await backend.downloadBook("h1", progress.on)).toEqual(book);
  const ranges = server.ranges();
  expect(last(ranges)).toBeNull();
  expect(sorted(ranges.slice(0, -1))).toEqual(sorted(chunkRanges([0, 1, 2, 3, 4], total)));
  // Every ranged GET had settled before the whole-body one went out.
  expect(last(server.sent)!.busy).toBe(0);
  expect(last(progress.seen)).toEqual([total, total]);
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
  const asked = server.sent.slice(before).map((s) => `${s.id} ${s.range}`);
  expect(asked.slice(0, 2)).toEqual(["id-old bytes=512-767", "id-new bytes=0-255"]);
  expect(sorted(asked.slice(2))).toEqual([
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
  const progress = recorder();
  expect(await backend.downloadBook("h1", progress.on)).toEqual(replaced);
  const ranges = server.ranges(before);
  // The only missing chunk reports a new size; the book starts again.
  expect(ranges.slice(0, 2)).toEqual(["bytes=256-511", "bytes=0-255"]);
  expect(sorted(ranges.slice(2))).toEqual(["bytes=256-511", "bytes=512-599"]);
  expect(last(progress.seen)).toEqual([600, 600]);
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
  expect(server.ranges(before).length).toBe(3);
});

test("removeBook drops the held bytes too", async () => {
  const server = makeServer();
  const book = blob(600);
  server.put("h1", "id-1", book);
  const { backend } = makeBackend(server, { h1: "id-1" });
  server.dropOn((s) => s.range === "bytes=256-511");
  await expect(backend.downloadBook("h1")).rejects.toBeInstanceOf(SyncTransportError);

  // The delete itself is not what is under test; only that the held bytes go.
  await backend.removeBook("h1").catch(() => undefined);
  server.dropOn(null);
  server.put("h1", "id-1", book);
  const before = server.sent.length;
  expect(await backend.downloadBook("h1")).toEqual(book);
  expect(server.ranges(before).filter((r) => r !== null)[0]).toBe("bytes=0-255");
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

test("a 206 that answers less of the range than was asked is retried, not placed", async () => {
  const server = makeServer();
  const book = blob(800);
  server.put("h1", "id-1", book);
  const { backend } = makeBackend(server, { h1: "id-1" });
  let once = false;
  server.shortOn((s) => {
    if (once || s.range !== "bytes=256-511") return false;
    once = true;
    return true;
  });

  expect(await backend.downloadBook("h1")).toEqual(book);
  expect(server.ranges().filter((r) => r === "bytes=256-511").length).toBe(2);
});

test("Content-Range is read only when it names a whole known range", () => {
  expect(parseContentRange("bytes 0-255/700")).toEqual({ start: 0, end: 255, total: 700 });
  expect(parseContentRange("bytes 0-255/*")).toBeNull();
  expect(parseContentRange("bytes */700")).toBeNull();
  expect(parseContentRange("bytes 300-255/700")).toBeNull();
  expect(parseContentRange("bytes 0-700/700")).toBeNull();
  expect(parseContentRange(null)).toBeNull();
});
