// Standalone harness for the EPUB rendering spike (docs/62). Not part of the
// app: it answers the questions docs/39 section 7 left open, the ones that need
// a real WKWebView and a real Tauri navigation handler rather than a reading of
// the source. Served by Vite in dev at /epub-spike.html, driven through
// scripts/ios-sim.sh eval, which is why every probe returns plain JSON.
//
// The book bytes come over HTTP from a separate little server (see docs/62), not
// from the checkout: the two books this measures are copyrighted and must not
// land in the repo.

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { unzipSync, type Unzipped } from "fflate";
import { EPUB } from "foliate-js/epub.js";
import type { View } from "foliate-js/view.js";

// ---------------------------------------------------------------- probes ----

/// What the page is running as. The custom-protocol questions in docs/39 all
/// start here: a blob URL inherits the origin of the page that minted it, so the
/// origin is half the answer.
function context() {
  return {
    origin: location.origin,
    protocol: location.protocol,
    href: location.href,
    isSecureContext: window.isSecureContext,
    crossOriginIsolated: window.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    userAgent: navigator.userAgent,
    dpr: window.devicePixelRatio,
    viewport: [window.innerWidth, window.innerHeight],
    // The meta CSP this harness injected, if any (epub-spike.html reads ?csp=).
    csp:
      document.querySelector<HTMLMetaElement>(
        'meta[http-equiv="Content-Security-Policy"]',
      )?.content ?? null,
  };
}

/// SHA-1 for EPUB font deobfuscation, and the segmenter foliate's search uses.
/// Both need more than a polyfill check: crypto.subtle is undefined outside a
/// secure context, and SHA-1 is the one digest browsers were free to drop.
async function cryptoProbe() {
  const out: Record<string, unknown> = {
    subtle: typeof crypto?.subtle,
    segmenter: typeof (Intl as { Segmenter?: unknown }).Segmenter,
  };
  try {
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode("abc"));
    out.sha1 = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    // The known answer, so a wrong implementation is not read as a pass.
    out.sha1Correct = out.sha1 === "a9993e364706816aba3e25717850c26c9cd0d89d";
  } catch (e) {
    out.sha1Error = String(e);
  }
  try {
    const seg = new (Intl as unknown as {
      Segmenter: new (l: string, o: object) => { segment(s: string): Iterable<unknown> };
    }).Segmenter("zh", { granularity: "word" });
    out.segments = [...seg.segment("具身智能的世界模型")].length;
  } catch (e) {
    out.segmenterError = String(e);
  }
  return out;
}

// ----------------------------------------------------------- blob iframe ----

/// The document loaded into the probe iframe. It carries every thing the spike
/// needs to see the answer to: a script (must not run), an inline handler (must
/// not run), and a blob-URL image, stylesheet and font (must load, or foliate
/// renders naked text).
function probeDocument(assets: { css: string; img: string; font: string }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<link rel="stylesheet" href="${assets.css}"/>
<script type="text/javascript">
  window.__scriptRan = true;
  try { parent.__spikeScriptReachedParent = true; } catch (e) {}
</script>
</head>
<body onload="window.__inlineRan = true; try { parent.__spikeInlineReachedParent = true } catch (e) {}">
<p id="p">probe</p>
<img id="img" src="${assets.img}" alt="probe"/>
</body>
</html>`;
}

const PROBE_CSS = (font: string) => `
@font-face { font-family: "SpikeFont"; src: url("${font}") format("truetype"); }
#p { color: rgb(1, 2, 3); font-family: "SpikeFont", serif; }
`;

/// A one-glyph TrueType font, so `document.fonts` has something real to load
/// rather than a 404. Base64 of a minimal TTF built for this probe.
const TTF_BASE64 =
  "AAEAAAAKAIAAAwAgT1MvMg7bB4wAAACsAAAAYGNtYXAADQEXAAABDAAAACxnbHlmuxrhewAAATgA" +
  "AAAcaGVhZBUeF3AAAAFUAAAANmhoZWEIAQQEAAABjAAAACRobXR4BAAAAAAAAbAAAAAIbG9jYQAO" +
  "AAAAAAG4AAAABm1heHAABAAgAAABwAAAACBuYW1lAAAAAAAAAeAAAAAicG9zdAADAAAAAAIEAAAA" +
  "IAAAAAAAAAAAAAAAAAAAAAA=";

function bytesFromBase64(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/// One run of the blob-iframe question. `sandbox` null means the attribute is
/// left off entirely, which is the control: it separates "blob iframes do not
/// load here" from "sandboxing broke it".
async function blobIframe(opts: { sandbox?: string | null; timeoutMs?: number } = {}) {
  const sandbox = opts.sandbox === undefined ? "allow-same-origin" : opts.sandbox;
  const timeoutMs = opts.timeoutMs ?? 4000;
  const started = performance.now();
  const urls: string[] = [];
  const mint = (data: BlobPart, type: string) => {
    const u = URL.createObjectURL(new Blob([data], { type }));
    urls.push(u);
    return u;
  };

  const font = mint(bytesFromBase64(TTF_BASE64), "font/ttf");
  const img = mint(
    // A 1x1 red PNG.
    bytesFromBase64(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    ),
    "image/png",
  );
  const css = mint(PROBE_CSS(font), "text/css");
  const doc = mint(probeDocument({ css, img, font }), "application/xhtml+xml");

  const w = window as unknown as Record<string, unknown>;
  delete w.__spikeScriptReachedParent;
  delete w.__spikeInlineReachedParent;

  const frame = document.createElement("iframe");
  if (sandbox !== null) frame.setAttribute("sandbox", sandbox);
  Object.assign(frame.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: "200px",
    height: "120px",
    border: "0",
    visibility: "hidden",
  });

  const result: Record<string, unknown> = { sandbox, blobUrl: doc };
  // Appending an iframe fires `load` for its initial about:blank, in WebKit
  // before the assigned src has even been fetched. Waiting for the first load
  // event therefore reports success for a navigation that was cancelled — which
  // is the exact failure docs/pitfall/99 says leaves no trace. So a load only
  // counts once the frame's document is no longer about:blank; a navigation
  // that never happens ends in the timeout instead.
  const blanks: string[] = [];
  const settled = await new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), timeoutMs);
    frame.addEventListener("load", () => {
      let uri: string | null = null;
      try {
        uri = frame.contentDocument?.documentURI ?? null;
      } catch {
        // Cross-origin: whatever it is, it is not about:blank.
        uri = "opaque";
      }
      if (uri === "about:blank") {
        blanks.push(uri);
        return;
      }
      clearTimeout(timer);
      resolve("load");
    });
    frame.addEventListener("error", () => {
      clearTimeout(timer);
      resolve("error");
    });
    document.body.append(frame);
    frame.src = doc;
  });
  result.blankLoads = blanks.length;
  result.event = settled;
  result.loadMs = Math.round(performance.now() - started);

  // Whatever happened, describe the frame from the parent's side.
  try {
    const cd = frame.contentDocument;
    result.contentDocument = cd ? "reachable" : null;
    if (cd) {
      result.documentURI = cd.documentURI;
      result.readyState = cd.readyState;
      result.bodyText = cd.body?.textContent?.trim() ?? null;
      result.contentType = cd.contentType;
      // A same-origin blob frame reports the parent's origin; an opaque one
      // reports "null" and reading it would have thrown above.
      result.frameOrigin = (cd.defaultView as Window | null)?.origin ?? null;
      const view = cd.defaultView as unknown as Record<string, unknown> | null;
      result.scriptRanInFrame = view ? view.__scriptRan === true : null;
      result.inlineRanInFrame = view ? view.__inlineRan === true : null;
      const p = cd.getElementById("p");
      result.cssApplied = p ? cd.defaultView?.getComputedStyle(p).color : null;
      const image = cd.getElementById("img") as HTMLImageElement | null;
      // The image may still be in flight when `load` fires for the document in
      // some engines; give it a beat.
      if (image && !image.complete) {
        await new Promise((r) => {
          image.addEventListener("load", r, { once: true });
          image.addEventListener("error", r, { once: true });
          setTimeout(r, 1000);
        });
      }
      result.imgComplete = image?.complete ?? null;
      result.imgWidth = image?.naturalWidth ?? null;
      try {
        await cd.fonts.ready;
        result.fontsLoaded = cd.fonts.size;
        result.fontCheck = cd.fonts.check('12px "SpikeFont"');
      } catch (e) {
        result.fontsError = String(e);
      }
    }
  } catch (e) {
    result.contentDocument = "threw";
    result.contentDocumentError = String(e);
  }
  result.scriptReachedParent = w.__spikeScriptReachedParent === true;
  result.inlineReachedParent = w.__spikeInlineReachedParent === true;

  // Does an event raised inside a scriptless sandboxed frame reach a listener
  // the parent installed on the frame's own document? WebKit bug 218086 is the
  // reason foliate ships allow-scripts; this is the measurement of it.
  try {
    const cd = frame.contentDocument;
    if (cd) {
      let seen = 0;
      cd.addEventListener("click", () => seen++);
      cd.getElementById("p")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      result.syntheticEventSeen = seen;
      let real = 0;
      cd.addEventListener("pointerdown", () => real++);
      result.pointerListenerInstalled = true;
      result.realPointerEvents = real;
    }
  } catch (e) {
    result.eventProbeError = String(e);
  }

  frame.remove();
  for (const u of urls) URL.revokeObjectURL(u);
  return result;
}

// ------------------------------------------------------------------ book ----

/// The zip side of the book object docs/39 describes: loadText / loadBlob /
/// getSize over an in-memory unzip, plus the sha1 foliate wants for obfuscated
/// fonts. No sanitizing here on purpose — that is the other line of work.
function makeLoader(files: Unzipped) {
  const decoder = new TextDecoder();
  const at = (href: string) => files[decodeURIComponent(href)] ?? files[href];
  return {
    loadText: (href: string) => {
      const bytes = at(href);
      return bytes ? decoder.decode(bytes) : null;
    },
    loadBlob: (href: string) => {
      const bytes = at(href);
      return bytes ? new Blob([bytes as BlobPart], { type: mimeOf(href) }) : null;
    },
    getSize: (href: string) => at(href)?.length ?? 0,
    sha1: async (data: ArrayBuffer | Uint8Array) => {
      const buf = await crypto.subtle.digest("SHA-1", data as BufferSource);
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    },
  };
}

const MIME: Record<string, string> = {
  xhtml: "application/xhtml+xml",
  html: "text/html",
  css: "text/css",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  ncx: "application/x-dtbncx+xml",
  opf: "application/oebps-package+xml",
  js: "text/javascript",
  xml: "application/xml",
};
function mimeOf(href: string) {
  return MIME[href.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

interface Timings {
  [k: string]: number | string | null | undefined;
}

let view: View | null = null;
let book: EPUB | null = null;
let sectionCount = 0;

async function openBook(url: string, opts: { flow?: string; maxColumn?: number } = {}) {
  const t: Timings = { url, flow: opts.flow ?? "paginated" };
  const t0 = performance.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  t.bytes = bytes.length;
  t.fetchMs = Math.round(performance.now() - t0);

  const t1 = performance.now();
  const files = unzipSync(bytes);
  t.unzipMs = Math.round(performance.now() - t1);
  t.entries = Object.keys(files).length;

  const t2 = performance.now();
  book = await new EPUB(makeLoader(files)).init();
  t.parseMs = Math.round(performance.now() - t2);
  sectionCount = book.sections.length;
  t.sections = sectionCount;
  t.largestSection = Math.max(...book.sections.map((s) => s.size || 0));

  // <foliate-view> is registered as a side effect of importing view.js, and the
  // import is dynamic so the timing above is not paying for the module graph.
  const t3 = performance.now();
  await import("foliate-js/view.js");
  t.moduleMs = Math.round(performance.now() - t3);

  const host = document.getElementById("view-host")!;
  host.textContent = "";
  const el = document.createElement("foliate-view") as View;
  host.append(el);
  view = el;

  const t4 = performance.now();
  // `relocate` is the first moment the renderer has laid out a page and knows
  // where it is: that, not open() resolving, is "there is something to read".
  const firstPaint = new Promise<number>((resolve) => {
    el.addEventListener("relocate", () => resolve(performance.now()), { once: true });
    setTimeout(() => resolve(NaN), 60000);
  });
  await el.open(book);
  el.renderer.setAttribute("flow", opts.flow ?? "paginated");
  el.renderer.setAttribute("gap", "6");
  el.renderer.setAttribute("max-column-count", String(opts.maxColumn ?? 1));
  t.openMs = Math.round(performance.now() - t4);
  const painted = await firstPaint;
  t.firstReadableMs = Number.isNaN(painted) ? "timeout" : Math.round(painted - t4);
  t.totalMs = Math.round(performance.now() - t0);
  Object.assign(t, memory());
  return t;
}

/// Where the reader would go by dragging the scrubber. Timed from the call to
/// the relocate that follows it.
async function goToFraction(fraction: number) {
  if (!view) throw new Error("no view");
  const t0 = performance.now();
  const done = new Promise<number>((resolve) => {
    view!.addEventListener("relocate", () => resolve(performance.now()), { once: true });
    setTimeout(() => resolve(NaN), 60000);
  });
  await view.goToFraction(fraction);
  const at = await done;
  return {
    fraction,
    ms: Number.isNaN(at) ? "timeout" : Math.round(at - t0),
    ...location_(),
    ...memory(),
  };
}

/// One page turn inside the section that is already laid out — the common case,
/// and the one that must feel instant.
async function turnPage(times = 1) {
  if (!view) throw new Error("no view");
  const each: number[] = [];
  for (let i = 0; i < times; i++) {
    const t0 = performance.now();
    const done = new Promise<void>((resolve) => {
      view!.addEventListener("relocate", () => resolve(), { once: true });
      setTimeout(resolve, 20000);
    });
    await view.next();
    await done;
    each.push(Math.round(performance.now() - t0));
  }
  return { each, median: each.slice().sort((a, b) => a - b)[each.length >> 1], ...memory() };
}

function location_() {
  const l = view?.lastLocation as
    | { current?: number; total?: number; fraction?: number; cfi?: string }
    | undefined;
  return {
    cfi: l?.cfi ?? null,
    page: l?.current ?? null,
    pages: l?.total ?? null,
    atFraction: l?.fraction ?? null,
  };
}

/// performance.memory is Chromium-only; WebKit has no equivalent, so on iOS the
/// number has to come from outside the page (see docs/62).
function memory() {
  const m = (performance as unknown as { memory?: Record<string, number> }).memory;
  return m
    ? { jsHeapMB: Math.round(m.usedJSHeapSize / 1048576), jsHeapLimitMB: Math.round(m.jsHeapSizeLimit / 1048576) }
    : { jsHeapMB: null };
}

/// The text in the frame, and whether the parent can reach into it at all —
/// which is what selection, CFI and highlighting all stand on.
function inspectContents() {
  if (!view) throw new Error("no view");
  const contents = view.renderer.getContents?.() ?? [];
  return contents.map((c) => {
    const doc = c.doc;
    const frame = doc?.defaultView?.frameElement as HTMLIFrameElement | null;
    return {
      index: c.index,
      sandbox: frame?.getAttribute("sandbox") ?? null,
      docURI: doc?.documentURI ?? null,
      textLength: doc?.body?.textContent?.length ?? null,
      firstText: doc?.body?.textContent?.trim().slice(0, 60) ?? null,
      fontFamily: doc?.body ? doc.defaultView!.getComputedStyle(doc.body).fontFamily : null,
      userSelect: doc?.body
        ? doc.defaultView!.getComputedStyle(doc.body).webkitUserSelect ||
          doc.defaultView!.getComputedStyle(doc.body).userSelect
        : null,
      images: doc?.images.length ?? null,
      imagesLoaded: doc ? [...doc.images].filter((i) => i.complete && i.naturalWidth > 0).length : null,
    };
  });
}

/// What the system did with a long press: an iOS callout leaves a selection
/// behind in the frame's document, and nothing else in this harness makes one.
function selectionState() {
  const out: Record<string, unknown> = {
    parent: String(document.getSelection() ?? ""),
  };
  try {
    const contents = view?.renderer.getContents?.() ?? [];
    out.frames = contents.map((c) => {
      const sel = c.doc?.getSelection();
      return {
        index: c.index,
        text: sel ? String(sel) : null,
        collapsed: sel?.isCollapsed ?? null,
        rangeCount: sel?.rangeCount ?? 0,
      };
    });
  } catch (e) {
    out.error = String(e);
  }
  return out;
}

// ------------------------------------------------------------------- ui -----

declare global {
  interface Window {
    __epubSpike: {
      context: typeof context;
      crypto: typeof cryptoProbe;
      blobIframe: typeof blobIframe;
      open: typeof openBook;
      goToFraction: typeof goToFraction;
      turnPage: typeof turnPage;
      contents: typeof inspectContents;
      selection: typeof selectionState;
      memory: typeof memory;
      log: unknown[];
      ready: boolean;
    };
  }
}

function Harness() {
  const [note, setNote] = useState("ready");
  useEffect(() => {
    window.__epubSpike = {
      context,
      crypto: cryptoProbe,
      blobIframe,
      open: (url, opts) =>
        openBook(url, opts).then((r) => {
          setNote(`opened ${url}`);
          window.__epubSpike.log.push(r);
          return r;
        }),
      goToFraction,
      turnPage,
      contents: inspectContents,
      selection: selectionState,
      memory,
      log: [],
      ready: true,
    };
    setNote("harness installed");
  }, []);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      <div style={{ font: "12px system-ui", padding: "4px 8px", flex: "0 0 auto" }} id="note">
        epub spike — {note}
      </div>
      <div id="view-host" style={{ flex: "1 1 auto", minHeight: 0, position: "relative" }} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
