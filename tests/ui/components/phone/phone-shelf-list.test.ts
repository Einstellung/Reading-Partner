// The phone's shelf, minus React (docs/70): which of a topic's files this shell
// can open, what a tap on each one does, and which book the home card offers to
// continue. Run: bun test.

import { expect, test } from "bun:test";
import type { LibraryEntry } from "../../../../src/platform/app/library";
import type { FileRef, Topic } from "../../../../src/platform/app/topics";
import {
  continueReading,
  materialNote,
  materialTap,
  shelfMaterials,
  NOT_FILED_YET,
  NOT_IMPORTED,
  PDF_ELSEWHERE,
} from "../../../../src/ui/components/phone/shelf-list";

const SIGNED_IN = { configured: true, signedIn: true };

function file(name: string, hash?: string, lastOpenedAt?: number): FileRef {
  return { path: `/books/${name}`, name, addedAt: 1, hash, lastOpenedAt } as FileRef;
}

function entry(hash: string, over: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    hash,
    title: hash,
    originalFilename: `${hash}.epub`,
    addedAt: 1,
    format: "epub",
    ...over,
  };
}

test("the registry says what a file is, and its name says so when the registry has not", () => {
  const files = [
    file("a.epub", "h1"),
    file("b.pdf", "h2"),
    // The registry's answer wins over the name.
    file("named-pdf.pdf", "h3"),
    file("never-imported.epub"),
    file("never-imported.pdf"),
    file("notes.txt"),
  ];
  const entries = {
    h1: entry("h1"),
    h2: entry("h2", { format: "pdf" }),
    h3: entry("h3", { format: "epub" }),
  };
  const m = shelfMaterials(files, entries, new Set(["h1", "h2", "h3"]));
  expect(m.map((x) => x.format)).toEqual(["epub", "pdf", "epub", "epub", "pdf", "unknown"]);
  expect(m.map((x) => x.filed)).toEqual([true, true, true, false, false, false]);
  // A file the registry has never heard of is not on this device either.
  expect(m[3].onDevice).toBe(false);
});

test("an entry with no format is the PDF it was before EPUBs existed", () => {
  const entries = { h1: { hash: "h1", title: "x", originalFilename: "x", addedAt: 1 } };
  const [m] = shelfMaterials([file("old.epub", "h1")], entries, new Set(["h1"]));
  expect(m.format).toBe("pdf");
});

test("an EPUB the desk has not imported says so instead of calling itself a PDF", () => {
  const [m] = shelfMaterials([file("added-on-the-desk.epub")], {}, new Set());
  expect(m.format).toBe("epub");
  expect(m.filed).toBe(false);
  expect(materialTap(m, SIGNED_IN)).toEqual({ kind: "unavailable", why: NOT_IMPORTED });
  expect(materialNote(m, false)).toBe("Not imported");
});

test("an EPUB whose library entry has not arrived yet is not fetched", () => {
  // topics.json and library.json are separate sync units: the row can be here
  // before the entry that describes it.
  const [m] = shelfMaterials([file("a.epub", "h1")], {}, new Set());
  expect(m.format).toBe("epub");
  expect(materialTap(m, SIGNED_IN)).toEqual({ kind: "unavailable", why: NOT_FILED_YET });
  expect(materialNote(m, false)).toBe("Not synced yet");
});

test("a file nothing describes and whose name says nothing is not opened", () => {
  const [m] = shelfMaterials([file("notes")], {}, new Set());
  expect(m.format).toBe("unknown");
  expect(materialTap(m, SIGNED_IN)).toEqual({ kind: "unavailable", why: NOT_IMPORTED });
  expect(materialNote(m, false)).toBe("Not imported");
  // Not even with bytes beside it: nothing has said what they are.
  const [here] = shelfMaterials([file("notes", "h9")], {}, new Set(["h9"]));
  expect(materialTap(here, SIGNED_IN).kind).toBe("unavailable");
});

test("a PDF the desk has not imported is still read elsewhere", () => {
  const [m] = shelfMaterials([file("paper.pdf")], {}, new Set());
  expect(materialTap(m, SIGNED_IN)).toEqual({ kind: "pdf" });
  expect(materialNote(m, false)).toBe("PDF");
});

test("an extension is read whatever its case", () => {
  const m = shelfMaterials([file("A.EPUB"), file("B.Pdf")], {}, new Set());
  expect(m.map((x) => x.format)).toEqual(["epub", "pdf"]);
});

test("an article is an EPUB and opens as one", () => {
  const entries = {
    h1: entry("h1", { kind: "article", sourceUrl: "https://example.com/x", publishedAt: "2026-09-01" }),
  };
  const [m] = shelfMaterials([file("piece.epub", "h1")], entries, new Set(["h1"]));
  expect(m.article).toBe(true);
  expect(m.format).toBe("epub");
  expect(m.line).toBe("example.com · 2026-09-01");
  expect(materialTap(m, SIGNED_IN)).toEqual({ kind: "open" });
});

test("a PDF says where it is read instead of opening", () => {
  const entries = { h1: entry("h1", { format: "pdf" }) };
  const [m] = shelfMaterials([file("book.pdf", "h1")], entries, new Set(["h1"]));
  expect(materialTap(m, SIGNED_IN)).toEqual({ kind: "pdf" });
  expect(PDF_ELSEWHERE).toBe("PDFs open on iPad and desktop");
  // The cover is drawn either way; only the label says what it is.
  expect(materialNote(m, false)).toBe("PDF");
});

test("a book that is not on this device is fetched by the tap", () => {
  const entries = { h1: entry("h1") };
  const [m] = shelfMaterials([file("a.epub", "h1")], entries, new Set());
  expect(materialNote(m, false)).toBe("In the cloud");
  expect(materialNote(m, true)).toBe("Downloading…");
  expect(materialTap(m, SIGNED_IN)).toEqual({ kind: "download", bookId: "h1" });
});

test("a device with no account says so rather than trying", () => {
  const entries = { h1: entry("h1") };
  const [m] = shelfMaterials([file("a.epub", "h1")], entries, new Set());
  const out = materialTap(m, { configured: true, signedIn: false });
  expect(out.kind).toBe("unavailable");
  const never = materialTap(m, { configured: false, signedIn: false });
  expect(never.kind).toBe("unavailable");
  // The two reasons are different: one is a build, the other is a session.
  expect((out as { why: string }).why).not.toBe((never as { why: string }).why);
});

test("a book that is here opens and says nothing extra", () => {
  const entries = { h1: entry("h1") };
  const [m] = shelfMaterials([file("a.epub", "h1")], entries, new Set(["h1"]));
  expect(materialTap(m, SIGNED_IN)).toEqual({ kind: "open" });
  expect(materialNote(m, false)).toBeNull();
});

test("Continue reading skips the PDF that was opened more recently", () => {
  const topics: Topic[] = [
    {
      id: "t1",
      name: "JITs",
      createdAt: 1,
      files: [file("paper.pdf", "h2", 200), file("book.epub", "h1", 100)],
    } as Topic,
  ];
  const entries = { h1: entry("h1"), h2: entry("h2", { format: "pdf" }) };
  expect(continueReading(topics, entries)).toEqual({
    topicId: "t1",
    topicName: "JITs",
    bookId: "h1",
    path: "/books/book.epub",
    title: "book",
  });
});

test("Continue reading is nothing until an EPUB has actually been opened", () => {
  const topics: Topic[] = [
    { id: "t1", name: "JITs", createdAt: 1, files: [file("book.epub", "h1")] } as Topic,
  ];
  expect(continueReading(topics, { h1: entry("h1") })).toBeNull();
  expect(continueReading([], {})).toBeNull();
});
