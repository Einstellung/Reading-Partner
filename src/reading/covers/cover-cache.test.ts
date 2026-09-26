import { describe, expect, test } from "bun:test";
import {
  cleanAuthor,
  coverBytesPlan,
  COVER_RENDER_LIMIT,
  COVER_RETRY_AFTER_MS,
  COVER_WIDTH_PX,
  coverFailurePath,
  coverImagePath,
  coverMetaPath,
  coverRequestKey,
  coverRetryDue,
  coverScaleFactor,
  createSingleFlight,
  parseCoverFailure,
  parseCoverMeta,
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
    reader: "pdfium",
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
    expect(parseCoverFailure({ reason: "render", at: 5, reader: "pdfium" })).toEqual({
      reason: "render",
      message: "",
      path: "",
      name: "",
      at: 5,
      reader: "pdfium",
    });
  });

  test("a reader nobody has heard of reads as no reader at all", () => {
    expect(parseCoverFailure({ reason: "render", at: 5, reader: "mupdf" })?.reader).toBeNull();
  });
});

describe("retry policy", () => {
  const at = (reason: CoverFailure["reason"], t: number): CoverFailure => ({
    reason,
    message: "",
    path: "",
    name: "",
    at: t,
    reader: "pdfium",
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

  test("a record that names no reader is retried at once", () => {
    // Written by a build whose only reader was PDFium, which refuses every
    // EPUB: it says nothing about a book the shelf can read today.
    expect(coverRetryDue({ ...at("open", 1_000), reader: null }, 1_000)).toBe(true);
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

  test("a forgotten answer is produced again, and only that one", async () => {
    const flight = createSingleFlight<string>();
    const runs: string[] = [];
    const work = (key: string) => async () => {
      runs.push(key);
      return key;
    };
    await flight.run("a", work("a"));
    await flight.run("b", work("b"));
    flight.forget("a");
    expect(await flight.run("a", work("a"))).toBe("a");
    expect(await flight.run("b", work("b"))).toBe("b");
    expect(runs).toEqual(["a", "b", "a"]);
  });

  test("forgetting a key nobody asked about is not an error", () => {
    const flight = createSingleFlight<string>();
    expect(() => flight.forget("nothing")).not.toThrow();
  });
});

describe("where a book's bytes come from", () => {
  const PICKED = { path: "/books/a.pdf" };
  const HASHED = { path: "/books/a.pdf", hash: "deadbeef" };

  test("a book this device holds is read out of the library", () => {
    const plan = coverBytesPlan(HASHED, true);
    expect(plan.from).toBe("library");
    expect(plan.absence).toBe("unreadable");
  });

  test("a book that is only in the account is not here yet, not broken", () => {
    const plan = coverBytesPlan(HASHED, false);
    expect(plan.absence).toBe("not-here-yet");
  });

  test("a file that was picked and never imported is read by its path", () => {
    const plan = coverBytesPlan(PICKED, false);
    expect(plan.from).toBe("picked");
    expect(plan.absence).toBe("unreadable");
  });

  test("only a file read by its path is answered by that path's marker", () => {
    expect(coverBytesPlan(PICKED, false).pathMarkerApplies).toBe(true);
    // The book arrived: the marker a build wrote when it had only the path is
    // about a read this entry no longer makes.
    expect(coverBytesPlan(HASHED, true).pathMarkerApplies).toBe(false);
    expect(coverBytesPlan(HASHED, false).pathMarkerApplies).toBe(false);
  });
});

describe("the author record", () => {
  test("it sits beside the cover, under the same book id", () => {
    expect(coverMetaPath("abc")).toBe("covers/abc.json");
  });

  test("an author is one line, with no run of space left in it", () => {
    expect(cleanAuthor("  Ashish Vaswani,\n  Noam Shazeer ")).toBe("Ashish Vaswani, Noam Shazeer");
    expect(cleanAuthor("\u0000Yann\u0007 LeCun")).toBe("Yann LeCun");
  });

  test("what a PDF writer leaves behind is no author", () => {
    expect(cleanAuthor("")).toBe("");
    expect(cleanAuthor("   ")).toBe("");
    expect(cleanAuthor("-")).toBe("");
    expect(cleanAuthor("()")).toBe("");
    expect(cleanAuthor("unknown")).toBe("");
    expect(cleanAuthor("N/A")).toBe("");
    expect(cleanAuthor(null)).toBe("");
    expect(cleanAuthor(undefined)).toBe("");
  });

  test("a field with a document dumped in it is cut to a line's worth", () => {
    expect(cleanAuthor("A".repeat(400))).toHaveLength(120);
  });

  test("a record survives the round trip, and a wrong shape does not parse", () => {
    expect(parseCoverMeta({ author: " Kahneman " })).toEqual({ author: "Kahneman" });
    // Written by a version that had nothing to say: still an answer, so the
    // book is not rendered again.
    expect(parseCoverMeta({})).toEqual({ author: "" });
    expect(parseCoverMeta({ author: 3 })).toBeNull();
    expect(parseCoverMeta(null)).toBeNull();
    expect(parseCoverMeta("x")).toBeNull();
  });
});

describe("how many render at once", () => {
  test("the limit is two, because the raster runs on the drawing thread", () => {
    expect(COVER_RENDER_LIMIT).toBe(2);
  });
});
