// Putting one spine document in the reflow column (docs/69): the shadow root a
// flow host is filled with. The same sanitized <html> element as the sheet's
// (page-mount.ts), cloned whole with nothing added inside it, so a CFI computed
// on the ingestion tree is true on this one too. Around it: a baseline for a
// single column the width of the host, the paper wash group, and an overlay in
// the host's own coordinates for the marks.

import { PAGE_WASH_CSS, PAGE_WASH_GROUP_CSS } from "../engine/page-wash";
import { FLOW_FONT_PX, FLOW_LINE_HEIGHT, FLOW_PAD_X, FLOW_PAD_Y } from "./flow-gesture";
import { READING_FONT_STACK, imagesSettled, rewriteResources, type PageResources } from "./page-mount";
import type { SpineDocument } from "./parse";

// The group's box is the sheet's (absolute, inset 0); in the column the paper
// is as tall as the words, so the group sits in flow and only the isolation is
// kept.
export const FLOW_BASELINE_CSS = `
.rp-paper {
  ${PAGE_WASH_GROUP_CSS};
  position: relative;
  inset: auto;
  padding: ${FLOW_PAD_Y}px ${FLOW_PAD_X}px;
}
.rp-wash { ${PAGE_WASH_CSS} }
.rp-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
html {
  display: block;
  font-family: ${READING_FONT_STACK};
  font-size: ${FLOW_FONT_PX}px;
  line-height: ${FLOW_LINE_HEIGHT};
  color: #1c1c1c;
  -webkit-hyphens: auto;
  hyphens: auto;
  overflow-wrap: break-word;
  text-rendering: optimizeLegibility;
}
head { display: none; }
body { display: block; margin: 0; padding: 0; }
p { margin: 0 0 0.75em; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; }
img, svg, video { max-width: 100%; height: auto; }
figure { margin: 1em 0; }
/* A table wider than the column scrolls sideways on its own; the column's
   pan-y stops at the nearest scroll container, which this makes the table. */
table { display: block; overflow-x: auto; max-width: 100%; border-collapse: collapse; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; }
a { color: inherit; }
/* The marks read a caret out of the column themselves and never use the system
   selection, so a long press here must raise nothing (docs/pitfall/49, 262).
   The !important is for a book that sets user-select on its own body. Unlike
   the sheet, no touch-action: the scroll is the browser's. */
html, body {
  -webkit-user-select: none !important;
  user-select: none !important;
  -webkit-touch-callout: none !important;
}
`;

export interface MountedFlow {
  /** The cloned <html>: the content root every CFI is resolved against. */
  root: Element;
  overlay: HTMLElement;
  /** Resolves once the pictures that decide the layout have loaded (or given up). */
  ready: Promise<void>;
}

/** Fill a flow host's shadow root with one spine document. */
export function mountFlowDocument(shadow: ShadowRoot, doc: SpineDocument, res: PageResources): MountedFlow {
  const owner = shadow.ownerDocument;
  shadow.replaceChildren();
  const base = owner.createElement("style");
  base.textContent = FLOW_BASELINE_CSS;
  const root = owner.importNode(doc.doc.documentElement, true);
  rewriteResources(root, doc, res);
  const paper = owner.createElement("div");
  paper.className = "rp-paper";
  const wash = owner.createElement("div");
  wash.className = "rp-wash";
  wash.setAttribute("aria-hidden", "true");
  paper.append(root, wash);
  const overlay = owner.createElement("div");
  overlay.className = "rp-overlay";
  shadow.append(base, paper, overlay);
  return { root, overlay, ready: imagesSettled(root) };
}
