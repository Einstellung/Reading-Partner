import { describe, expect, test } from "bun:test";
import {
  COVER_RETRY_AFTER_MS,
  COVER_WIDTH_PX,
  coverFailurePath,
  coverImagePath,
  coverRequestKey,
  coverRetryDue,
  coverScaleFactor,
  createSingleFlight,
  parseCoverFailure,
  unreadableKey,
  type CoverFailure,
} from "./cover-cache";

describe("keys", () => {
  test("a cover is filed under the book id, so replaced content cannot hit it", () => {
    expect(coverImagePath("abc")).toBe("covers/abc.jpg");
    expect(coverImagePath("abc")).not.toBe(coverImagePath("def"));
  });

  test("the failure marker sits beside the cover it explains", () => {
    expect(coverFailurePath("abc")).toBe("covers/abc.failed.json");
  });

  test("different paths get different unreadable keys, the same path one key", () => {
    expect(unreadableKey("/books/a.pdf")).toBe(unreadableKey("/books/a.pdf"));
    expect(unreadableKey("/books/a.pdf")).not.toBe(unreadableKey("/books/b.pdf"));
    expect(unreadableKey("/books/a.pdf")).toMatch(/^path-[0-9a-f]+$/);
  });

  test("a file with a book id dedupes on it, one without falls back to its path", () => {
    const hashed = { path: "/books/a.pdf", hash: "deadbeef" };
    expect(coverRequestKey(hashed)).toBe("id-deadbeef");
    expect(coverRequestKey({ path: "/moved/a.pdf", hash: "deadbeef" })).toBe("id-deadbeef");
    expect(coverRequestKey({ path: "/books/a.pdf" })).toBe(unreadableKey("/books/a.pdf"));
    expect(coverRequestKey({ path: "/books/a.pdf" })).not.toBe(coverRequestKey(hashed));
  });
});

describe("raster size", () => {
  test("an A4 page is scaled down to the thumbnail width", () => {
    expect(coverScaleFactor(595.28) * 595.28).toBeCloseTo(COVER_WIDTH_PX, 5);
  });

  test("a page with no usable width falls back to Letter instead of NaN", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const scale = coverScaleFactor(bad);
      expect(Number.isFinite(scale)).toBe(true);
      expect(scale).toBeCloseTo(COVER_WIDTH_PX / 612, 5);
    }
  });

  test("a degenerate page size cannot ask for an absurd raster", () => {
    expect(coverScaleFactor(0.001)).toBeLessThanOrEqual(4);
    expect(coverScaleFactor(1e9)).toBeGreaterThanOrEqual(0.05);
  });
});

describe("failure records", () => {
  const failure: CoverFailure = {
    reason: "open",
    message: "FPDF_LoadMemDocument failed",
    path: "/books/a.pdf",
    name: "a.pdf",
    at: 1_000,
  };

  test("a round trip keeps what a diagnosis needs", () => {
    expect(parseCoverFailure(JSON.parse(JSON.stringify(failure)))).toEqual(failure);
  });

  test("junk and unknown reasons are not records", () => {
    expect(parseCoverFailure(null)).toBeNull();
    expect(parseCoverFailure("open")).toBeNull();
    expect(parseCoverFailure({})).toBeNull();
    expect(parseCoverFailure({ reason: "whatever", at: 1 })).toBeNull();
    expect(parseCoverFailure({ reason: "open" })).toBeNull();
  });

  test("a record with the strings missing still blocks a retry", () => {
    expect(parseCoverFailure({ reason: "render", at: 5 })).toEqual({
      reason: "render",
      message: "",
      path: "",
      name: "",
      at: 5,
    });
  });
});

describe("retry policy", () => {
  const at = (reason: CoverFailure["reason"], t: number): CoverFailure => ({
    reason,
    message: "",
    path: "",
    name: "",
    at: t,
  });

  test("no record means nothing has been tried", () => {
    expect(coverRetryDue(null, 0)).toBe(true);
  });

  test("a fresh failure is not retried on the next visit to the shelf", () => {
    expect(coverRetryDue(at("render", 1_000), 1_000)).toBe(false);
    expect(coverRetryDue(at("render", 1_000), 1_000 + COVER_RETRY_AFTER_MS - 1)).toBe(false);
  });

  test("an old failure is tried again, so an offline file is not written off", () => {
    expect(coverRetryDue(at("unreadable", 1_000), 1_000 + COVER_RETRY_AFTER_MS)).toBe(true);
  });
});

describe("single flight", () => {
  interface Deferred<T> {
    promise: Promise<T>;
    resolve: (v: T) => void;
    reject: (e: unknown) => void;
  }

  function deferred<T>(): Deferred<T> {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  test("three cards asking for the same cover render it once", async () => {
    const flight = createSingleFlight<string>();
    const d = deferred<string>();
    let runs = 0;
    const work = () => {
      runs++;
      return d.promise;
    };
    const all = Promise.all([flight.run("k", work), flight.run("k", work), flight.run("k", work)]);
    d.resolve("cover");
    expect(await all).toEqual(["cover", "cover", "cover"]);
    expect(runs).toBe(1);
  });

  test("a settled cover is not produced again", async () => {
    const flight = createSingleFlight<string>();
    let runs = 0;
    const work = async () => {
      runs++;
      return "cover";
    };
    expect(await flight.run("k", work)).toBe("cover");
    expect(await flight.run("k", work)).toBe("cover");
    expect(runs).toBe(1);
  });

  test("different books do not share a render", async () => {
    const flight = createSingleFlight<string>();
    const seen: string[] = [];
    await Promise.all([
      flight.run("a", async () => {
        seen.push("a");
        return "a";
      }),
      flight.run("b", async () => {
        seen.push("b");
        return "b";
      }),
    ]);
    expect(seen.sort()).toEqual(["a", "b"]);
  });

  test("a rejection is not kept as the answer", async () => {
    const flight = createSingleFlight<string>();
    let runs = 0;
    const work = async () => {
      runs++;
      if (runs === 1) throw new Error("boom");
      return "cover";
    };
    await expect(flight.run("k", work)).rejects.toThrow("boom");
    expect(await flight.run("k", work)).toBe("cover");
    expect(runs).toBe(2);
  });
});
