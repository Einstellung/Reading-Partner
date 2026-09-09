// What a mark on an EPUB has to survive: the trip from a selection to a range
// CFI and back, the repair when that CFI stops resolving, and the order the
// trace list puts marks in.
//
// The CFI half is asserted against foliate's own epubcfi.js — the code that
// will resolve it in the reader — and against a document put through the same
// parse/serialize round trip the renderer puts one through (render-cfi.test.ts
// says why that matters).

import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import {
  compactWords,
  epubSortOffset,
  epubPositionOf,
  findQuoteSpan,
  makeEpubSortIndex,
  markStroke,
  newEpubMark,
  quoteSelectorAt,
  quoteSelectorOf,
  rangeAtSpan,
  sameWords,
} from "../../../src/reading/epub/annotation";
import { paginate } from "../../../src/reading/epub/paginate";
import { parseEpub } from "../../../src/reading/epub/parse";
import { indexRuns, offsetOfPoint } from "../../../src/reading/epub/reader-logic";
import { renderLoader } from "../../../src/reading/epub/render-book";
import { extractDocumentText } from "../../../src/reading/epub/text";
import { annotationPage } from "../../../src/platform/app/reader-contract";
import { toDistillAnnotations } from "../../../src/memory/observations/arrears";
import { routeEpubPointer, strokeOfTool } from "../../../src/reading/epub/pen";
import { buildEpub, prose } from "./fixture";

const EPUBCFI = "../../../vendor/foliate-js/epubcfi.js";
const CFI = (await import(EPUBCFI)) as {
  parse(cfi: string): unknown;
  toRange(doc: Document, parts: unknown): Range;
  fromRange(range: Range): string;
  joinIndir(...parts: string[]): string;
  fake: { fromIndex(index: number): string };
};

const { JSDOM } = createRequire(import.meta.url)("jsdom") as typeof import("jsdom");
const XMLSerializer = new JSDOM("").window.XMLSerializer;

function frameDocument(source: string): Document {
  const parser = new DOMParser();
  const once = parser.parseFromString(source, "application/xhtml+xml");
  return parser.parseFromString(new XMLSerializer().serializeToString(once), "application/xhtml+xml");
}

// One synthetic book, rendered the way the reader renders it.
function frames(spec: Parameters<typeof buildEpub>[0]): {
  docs: Document[];
  pagination: ReturnType<typeof paginate>;
} {
  const book = parseEpub(buildEpub(spec));
  const loader = renderLoader(book);
  return {
    docs: book.docs.map((d) => frameDocument(loader.loadText(d.entry)!)),
    pagination: paginate(book),
  };
}

// The CFI the reader writes for a range: foliate's own two steps, the spine
// item and the range inside it (view.js: getCFI).
function cfiOf(index: number, range: Range): string {
  return CFI.joinIndir(CFI.fake.fromIndex(index), CFI.fromRange(range));
}

// And the reader's way back (view.js: resolveCFI).
function rangeOf(doc: Document, cfi: string): Range {
  const parts = CFI.parse(cfi) as { parent?: unknown[] } & unknown[];
  ((parts.parent ?? parts) as unknown[]).shift();
  return CFI.toRange(doc, parts);
}

describe("a marked range survives being written as a CFI", () => {
  test("round trip lands on the same characters", () => {
    const { docs } = frames({
      docs: [
        { name: "c1.xhtml", body: `<h1>One</h1>${prose(8, 300)}` },
        { name: "c2.xhtml", body: `<h1>Two</h1><p>alpha beta gamma</p>${prose(6, 260)}` },
      ],
    });

    for (const [index, doc] of docs.entries()) {
      const text = extractDocumentText(doc);
      const runs = indexRuns(text);
      // Four spans spread through the document, each a real run of words.
      for (const at of [10, 120, 400, Math.max(0, text.text.length - 90)]) {
        const span = { start: at, end: Math.min(text.text.length, at + 40) };
        const range = rangeAtSpan(doc, text, span);
        expect(range).not.toBeNull();
        const back = rangeOf(doc, cfiOf(index, range!));
        expect(offsetOfPoint(text, runs, back.startContainer, back.startOffset)).toBe(span.start);
        expect(compactWords(back.toString())).toBe(compactWords(range!.toString()));
      }
    }
  });

  test("a range CFI is a range, not a point", () => {
    const { docs } = frames({ docs: [{ name: "c1.xhtml", body: `<p>alpha beta gamma delta</p>` }] });
    const text = extractDocumentText(docs[0]);
    const range = rangeAtSpan(docs[0], text, { start: 6, end: 15 })!;
    const cfi = cfiOf(0, range);
    expect(cfi).toContain(",");
    expect(rangeOf(docs[0], cfi).toString()).toBe("beta gamm");
  });
});

describe("the quote is the repair when the CFI is not", () => {
  test("the words are found again in a document whose tree moved", () => {
    const { docs } = frames({
      docs: [{ name: "c1.xhtml", body: `<p>one</p><p>the passage that was marked</p><p>three</p>` }],
    });
    const text = extractDocumentText(docs[0]);
    const start = text.text.indexOf("passage");
    const quote = quoteSelectorAt(text.text, { start, end: start + 7 });

    // The same book with a paragraph inserted ahead of it: every CFI step past
    // the insertion now names a different node, and the quote does not care.
    const moved = frames({
      docs: [
        {
          name: "c1.xhtml",
          body: `<p>one</p><p>inserted</p><p>the passage that was marked</p><p>three</p>`,
        },
      ],
    });
    const after = extractDocumentText(moved.docs[0]);
    const span = findQuoteSpan(after.text, quote);
    expect(span).not.toBeNull();
    const range = rangeAtSpan(moved.docs[0], after, span!);
    expect(range?.toString()).toBe("passage");
  });

  test("the neighbours pick the copy that was marked", () => {
    const text = "say it again. say it again. say it again.";
    const second = text.indexOf("again", text.indexOf("again") + 1);
    const quote = quoteSelectorAt(text, { start: second, end: second + 5 });
    expect(findQuoteSpan(text, quote)).toEqual({ start: second, end: second + 5 });
  });

  test("with the neighbours gone, the copy nearest where it was", () => {
    const text = "again ... again ... again";
    const bare = { type: "TextQuoteSelector" as const, exact: "again", prefix: "", suffix: "" };
    expect(findQuoteSpan(text, bare, 20)).toEqual({ start: 20, end: 25 });
    expect(findQuoteSpan(text, bare, 0)).toEqual({ start: 0, end: 5 });
  });

  test("words that are not there any more repair to nothing", () => {
    const quote = quoteSelectorAt("a passage", { start: 2, end: 9 });
    expect(findQuoteSpan("nothing like it", quote)).toBeNull();
  });

  test("a block boundary reads the same from either side", () => {
    // The extraction writes a newline between blocks; a DOM range reports the
    // markup's own whitespace, which is none. Same words all the same.
    expect(sameWords("one\ntwo", "onetwo")).toBe(true);
    expect(sameWords("one two", "one three")).toBe(false);
    expect(sameWords("alpha", "beta")).toBe(false);
  });
});

describe("the mark's own shape", () => {
  const mark = newEpubMark({
    id: "m1",
    stroke: "highlight",
    color: "#ffd400",
    cfi: "epubcfi(/6/8!/4/2,/1:10,/1:24)",
    spineIndex: 3,
    span: { start: 4210, end: 4224 },
    pageIndex: 12,
    pageLabel: "97",
    quote: { type: "TextQuoteSelector", exact: "fourteen chars", prefix: "before ", suffix: " after" },
    authorName: "Reading-Partner",
    now: "2026-09-09T00:00:00.000Z",
  });

  test("the position is a FragmentSelector holding the CFI", () => {
    expect(mark.position).toEqual({
      type: "FragmentSelector",
      conformsTo: "http://www.idpf.org/epub/linking/cfi/epub-cfi.html",
      value: "epubcfi(/6/8!/4/2,/1:10,/1:24)",
      pageIndex: 12,
    });
    expect(epubPositionOf(mark)?.value).toBe("epubcfi(/6/8!/4/2,/1:10,/1:24)");
    expect(quoteSelectorOf(mark)?.exact).toBe("fourteen chars");
    expect(markStroke(mark)).toBe("highlight");
  });

  test("the page every reader of a mark asks for is the position block", () => {
    // distill.ts, arrears.ts, use-notes.ts and the trace list all go through
    // this one function, and it is the N in [p.N].
    expect(annotationPage(mark as { position?: { pageIndex?: number } })).toBe(13);
    expect(mark.pageLabel).toBe("97");
    expect(mark.text).toBe("fourteen chars");
  });

  test("distillation reads the passage and the block off it", () => {
    const [distilled] = toDistillAnnotations([mark as never]);
    expect(distilled).toEqual({
      id: "m1",
      page: 13,
      text: "fourteen chars",
      comment: "",
      createdAt: Date.parse("2026-09-09T00:00:00.000Z"),
    });
  });

  test("a chat mark is still not a page mark", () => {
    expect(markStroke({ type: "ink" })).toBeNull();
    expect(epubPositionOf({ position: { pageIndex: 3 } })).toBeNull();
    expect(quoteSelectorOf({ quote: { type: "TextQuoteSelector", exact: "" } })).toBeNull();
  });
});

describe("the order the trace list reads marks in", () => {
  test("the key sorts by spine item then by character", () => {
    const keys = [
      makeEpubSortIndex(2, 100),
      makeEpubSortIndex(0, 90000),
      makeEpubSortIndex(2, 99),
      makeEpubSortIndex(10, 0),
      makeEpubSortIndex(0, 5),
    ];
    expect([...keys].sort()).toEqual([
      makeEpubSortIndex(0, 5),
      makeEpubSortIndex(0, 90000),
      makeEpubSortIndex(2, 99),
      makeEpubSortIndex(2, 100),
      makeEpubSortIndex(10, 0),
    ]);
  });

  test("the offset is readable back off the key", () => {
    expect(epubSortOffset(makeEpubSortIndex(4, 1234))).toBe(1234);
    expect(epubSortOffset("00004|000123|00045")).toBeNull();
    expect(epubSortOffset(undefined)).toBeNull();
  });
});

describe("which pointer marks the book and which moves it", () => {
  const highlight = { type: "highlight" as const, color: "#ffd400" };
  const underline = { type: "underline" as const, color: "#a28ae5" };

  test("no pen out, nothing draws", () => {
    expect(routeEpubPointer(undefined, "pen", true)).toBe("navigate");
    expect(routeEpubPointer({ type: "pointer" }, "mouse", true)).toBe("navigate");
  });

  test("a pen out: stylus and mouse draw, the finger asks the setting", () => {
    expect(routeEpubPointer(highlight, "pen", false)).toBe("draw");
    expect(routeEpubPointer(highlight, "mouse", false)).toBe("draw");
    expect(routeEpubPointer(highlight, "touch", false)).toBe("navigate");
    expect(routeEpubPointer(highlight, "touch", true)).toBe("draw");
  });

  test("the navigation lock takes the stylus too", () => {
    expect(routeEpubPointer({ type: "navlock" }, "pen", true)).toBe("navigate");
    expect(routeEpubPointer({ type: "navlock" }, "touch", true)).toBe("navigate");
  });

  test("ink has nothing to hold onto in a reflowing book", () => {
    expect(strokeOfTool({ type: "ink", color: "#a28ae5" })).toBeNull();
    expect(routeEpubPointer({ type: "ink" }, "pen", false)).toBe("navigate");
    expect(strokeOfTool(highlight)).toBe("highlight");
    expect(strokeOfTool(underline)).toBe("underline");
  });
});
