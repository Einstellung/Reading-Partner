// The book's typography, and the app's colours reaching into the book's frame.
//
// The frame is a blob document: it is same-origin, but it is not in the app's
// document, so none of the app's custom properties are inherited into it. The
// values are read off the app's root and written into the stylesheet foliate
// injects (renderer.setStyles), which is why this is a string builder rather
// than a stylesheet file.
//
// The book brings no CSS of its own (render-book.ts), so this is all the type
// there is. It is a reading stylesheet, not a reset: paragraph rhythm, a
// measure that does not run to the window's edge, figures that fit the column.

import { fontSizeAt } from "./reader-logic";

export interface ReaderTheme {
  /** The paper the words sit on — the app's reading ground (docs/42). */
  background: string;
  foreground: string;
  /** Secondary text: captions, footnote markers. */
  muted: string;
  /** Whether the app is in its dark palette, which the book must follow. */
  dark: boolean;
}

const FALLBACK: ReaderTheme = {
  background: "#faf9f6",
  foreground: "#252922",
  muted: "#5c6058",
  dark: false,
};

/**
 * The theme as the app is currently painted. Read at the moment the styles are
 * written, so a paper-tint switch or a system dark-mode change reaches the book
 * by re-applying the styles rather than by a second source of truth.
 */
export function readerThemeOf(root: HTMLElement | null): ReaderTheme {
  if (!root || typeof getComputedStyle !== "function") return FALLBACK;
  const cs = getComputedStyle(root);
  const read = (name: string, fallback: string): string => {
    const value = cs.getPropertyValue(name).trim();
    return value === "" ? fallback : value;
  };
  return {
    // --desk is the ground the pages sit on; it is what makes an EPUB page and
    // a PDF page the same colour under the same tint.
    background: read("--desk", FALLBACK.background),
    foreground: read("--foreground", FALLBACK.foreground),
    muted: read("--muted-foreground", FALLBACK.muted),
    dark: root.classList.contains("dark") || root.getAttribute("data-theme") === "dark",
  };
}

// The Latin face first and a CJK stack behind it: a bilingual book sets Latin
// and Chinese in the same paragraph, and a single family for both gives one of
// the two the wrong shapes. The system faces are named rather than loaded — a
// web font in the frame would be a second blob and a second CSP question, for
// nothing this book needs.
const SERIF_STACK =
  '"Iowan Old Style", "Source Serif 4", Georgia, "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", serif';

/**
 * The stylesheet injected into the book's frame. Every rule is !important-free:
 * the book has no competing stylesheet, and foliate's own column geometry is
 * written with !important on top of this.
 */
export function readerCss(fontStep: number, theme: ReaderTheme): string {
  const size = fontSizeAt(fontStep);
  return `
html {
  color-scheme: ${theme.dark ? "dark" : "light"};
  font-size: ${size}px;
  font-family: ${SERIF_STACK};
  hyphens: auto;
}
body {
  background: ${theme.background};
  color: ${theme.foreground};
  margin: 0;
  line-height: 1.75;
  text-align: start;
  overflow-wrap: break-word;
  font-variant-numeric: oldstyle-nums proportional-nums;
}
p { margin: 0 0 0.85em; text-indent: 0; }
p + p { margin-top: 0; }
h1, h2, h3, h4, h5, h6 {
  line-height: 1.3;
  margin: 1.6em 0 0.6em;
  font-weight: 600;
  break-after: avoid-column;
}
h1 { font-size: 1.5em; }
h2 { font-size: 1.3em; }
h3 { font-size: 1.15em; }
h4, h5, h6 { font-size: 1em; }
blockquote {
  margin: 1em 0 1em 1.2em;
  padding-inline-start: 0.9em;
  border-inline-start: 2px solid ${theme.muted};
  color: ${theme.muted};
}
figure { margin: 1.2em 0; text-align: center; }
figcaption { font-size: 0.85em; color: ${theme.muted}; margin-top: 0.5em; line-height: 1.5; }
img, svg { max-width: 100%; height: auto; }
/* A picture taller than the column is clipped by the column, not scaled by it,
   so the height is capped as well as the width. */
img { max-height: 90vh; object-fit: contain; }
table { border-collapse: collapse; margin: 1em 0; font-size: 0.9em; }
th, td { border: 1px solid ${theme.muted}; padding: 0.3em 0.5em; text-align: start; }
pre { white-space: pre-wrap; font-size: 0.85em; overflow-x: auto; }
code, pre, kbd, samp { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
a { color: inherit; text-decoration-color: ${theme.muted}; }
hr { border: 0; border-top: 1px solid ${theme.muted}; margin: 1.5em 0; opacity: 0.5; }
ul, ol { padding-inline-start: 1.4em; }
li { margin: 0.3em 0; }
sup, sub { line-height: 0; }
`;
}

// The renderer's own geometry, as attributes on <foliate-paginator>. Each value
// is written verbatim into a custom property that is read twice: by parseFloat
// in the layout arithmetic, and by the shadow stylesheet's own calc(). So every
// length carries a unit — parseFloat ignores a "px" or "%" suffix, while the
// stylesheet's grid template is dropped whole without one (docs/pitfall/251).
// The unit has to be the one the property is used as: --_gap is divided by 100
// and is a percentage of the container (see the derivation in paginator.js).
//
// The gap is zero because it is the one number the two flows read differently:
// paginated takes one gap out of the column, continuous takes two out of a
// container that is a different width again, and that is what put the same book
// at two measures. The reading margin is inline padding on the element instead
// (reader-view.ts), which both flows are inside.
//
// margin is the block-axis room for the head and foot marginals.
// max-column-count 1 keeps one column per screen on a phone and on a tablet
// alike — two columns of a bilingual book on an iPad read as four.
export const RENDERER_GEOMETRY = {
  gap: "0%",
  margin: "24px",
  "max-inline-size": "720px",
  "max-block-size": "1440px",
  "max-column-count": "1",
} as const;
