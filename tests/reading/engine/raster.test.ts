// The open -> render -> close sequence against a fake engine: what each outcome
// is reported as, that the document is always closed, and that the two
// deadlines fire. The real PDFium engine needs a webview and a wasm compile, so
// the sequence is driven here through renderFirstPageJpegOn, which takes the
// engine it works on.

import { expect, test } from "bun:test";
import type { PdfDocumentObject, PdfEngine, PdfPageObject } from "@embedpdf/models";
import { renderFirstPageJpegOn } from "../../../src/reading/engine/raster";

// Every engine call is asynchronous in the real thing (the task resolves on a
// later turn), so the fakes resolve on a later turn too: an `await` dropped from
// the sequence must not still pass.
function later<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 0));
}

function task<T>(promise: Promise<T>) {
  return { toPromise: () => promise };
}

interface Calls {
  opened: { id: string; content: ArrayBuffer }[];
  rendered: { page: PdfPageObject; options: Record<string, unknown> }[];
  closed: PdfDocumentObject[];
}

interface FakeParts {
  open?: () => Promise<PdfDocumentObject>;
  render?: () => Promise<Blob>;
}

const PAGE: PdfPageObject = { index: 0, size: { width: 400, height: 800 } } as PdfPageObject;
const DOC: PdfDocumentObject = { id: "doc", pageCount: 1, pages: [PAGE] } as PdfDocumentObject;

function fakeEngine(parts: FakeParts = {}): { engine: PdfEngine<Blob>; calls: Calls } {
  const calls: Calls = { opened: [], rendered: [], closed: [] };
  const engine = {
    openDocumentBuffer: (file: { id: string; content: ArrayBuffer }) => {
      calls.opened.push(file);
      return task(parts.open ? parts.open() : later(DOC));
    },
    renderPage: (_doc: PdfDocumentObject, page: PdfPageObject, options: Record<string, unknown>) => {
      calls.rendered.push({ page, options });
      return task(parts.render ? parts.render() : later(new Blob([new Uint8Array([1, 2, 3])])));
    },
    closeDocument: (doc: PdfDocumentObject) => {
      calls.closed.push(doc);
      return task(later(true));
    },
  } as unknown as PdfEngine<Blob>;
  return { engine, calls };
}

const OPTS = { scaleFactor: (w: number) => 240 / w, quality: 0.8 };

test("a rendered first page comes back as bytes, and the document is closed", async () => {
  const { engine, calls } = fakeEngine();
  const bytes = new Uint8Array([9, 9, 9, 9]);

  const result = await renderFirstPageJpegOn(engine, bytes, { ...OPTS, id: "cover:abc" });

  expect(result).toEqual({ kind: "ok", jpeg: new Uint8Array([1, 2, 3]) });
  expect(calls.opened[0].id).toBe("cover:abc");
  expect(calls.rendered[0].page).toBe(PAGE);
  expect(calls.closed).toEqual([DOC]);
});

test("the engine is handed a copy of the bytes, not the caller's buffer", async () => {
  const { engine, calls } = fakeEngine();
  const bytes = new Uint8Array([7, 7, 7, 7]);

  await renderFirstPageJpegOn(engine, bytes, OPTS);

  // The engine takes ownership of what it is given; the caller keeps its own.
  expect(calls.opened[0].content).not.toBe(bytes.buffer);
  expect(new Uint8Array(calls.opened[0].content)).toEqual(bytes);
});

test("the scale factor is asked for with the page's own width", async () => {
  const { engine, calls } = fakeEngine();

  await renderFirstPageJpegOn(engine, new Uint8Array([1]), {
    scaleFactor: (w) => 240 / w,
    quality: 0.8,
  });

  expect(calls.rendered[0].options.scaleFactor).toBe(240 / 400);
});

// Pitfall 102: the encoder reads `quality`, the documented option is
// `imageQuality`. Sending only the documented one silently renders at the canvas
// default and half again as large.
test("the JPEG quality is sent under both names", async () => {
  const { engine, calls } = fakeEngine();

  await renderFirstPageJpegOn(engine, new Uint8Array([1]), { ...OPTS, quality: 0.42 });

  expect(calls.rendered[0].options.imageType).toBe("image/jpeg");
  expect(calls.rendered[0].options.imageQuality).toBe(0.42);
  expect(calls.rendered[0].options.quality).toBe(0.42);
});

test("a document that opens with no pages is reported as no-pages, not rendered", async () => {
  const empty = { id: "doc", pageCount: 0, pages: [] } as unknown as PdfDocumentObject;
  const { engine, calls } = fakeEngine({ open: () => later(empty) });

  const result = await renderFirstPageJpegOn(engine, new Uint8Array([1]), OPTS);

  expect(result.kind).toBe("no-pages");
  expect(calls.rendered).toEqual([]);
  expect(calls.closed).toEqual([empty]);
});

test("a refused open is reported as open-failed, carrying the engine's error", async () => {
  const boom = new Error("not a PDF");
  const { engine, calls } = fakeEngine({ open: () => Promise.reject(boom) });

  const result = await renderFirstPageJpegOn(engine, new Uint8Array([1]), OPTS);

  expect(result).toEqual({ kind: "open-failed", cause: boom });
  // Nothing was opened, so nothing may be closed.
  expect(calls.closed).toEqual([]);
});

test("a failed render is reported as render-failed, and still closes the document", async () => {
  const boom = new Error("raster failed");
  const { engine, calls } = fakeEngine({ render: () => Promise.reject(boom) });

  const result = await renderFirstPageJpegOn(engine, new Uint8Array([1]), OPTS);

  expect(result).toEqual({ kind: "render-failed", cause: boom });
  expect(calls.closed).toEqual([DOC]);
});

test("an open that never lands times out, and the late document is closed", async () => {
  let land: (doc: PdfDocumentObject) => void = () => {};
  const { engine, calls } = fakeEngine({
    open: () => new Promise<PdfDocumentObject>((resolve) => (land = resolve)),
  });

  const result = await renderFirstPageJpegOn(engine, new Uint8Array([1]), OPTS, { openMs: 5 });

  expect(result.kind).toBe("timeout");
  expect(result).toMatchObject({ message: expect.stringContaining("openDocumentBuffer") });
  expect(calls.closed).toEqual([]);

  // The open may still land after the deadline. It must not leave a document
  // behind on the engine the reader shares.
  land(DOC);
  await new Promise((r) => setTimeout(r, 0));
  expect(calls.closed).toEqual([DOC]);
});

test("a render that never lands times out and the document is closed", async () => {
  const { engine, calls } = fakeEngine({ render: () => new Promise<Blob>(() => {}) });

  const result = await renderFirstPageJpegOn(engine, new Uint8Array([1]), OPTS, { renderMs: 5 });

  expect(result.kind).toBe("timeout");
  expect(result).toMatchObject({ message: expect.stringContaining("renderPage") });
  expect(calls.closed).toEqual([DOC]);
});
