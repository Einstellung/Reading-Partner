// The palette is declared once, in src/styles.css, and everything else names a
// token (docs/30, docs/37 A7). Two rules, both read off the stylesheet rather
// than off a copy of it, so a retheme cannot leave this test asserting the old
// colours:
//
//   1. no colour that already has a token is written out by value anywhere in
//      src, in a class or otherwise;
//   2. only the files listed below hold a colour literal at all.
//
// What is deliberately not in here: the shades with no token of their own (the
// status ambers and greens, the paper tints). styles.css says why — they carry
// meaning, not identity — and docs/37 C holds their list against the day the
// palette gets a dark mode.
//
// Run: bun test.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

// #rgb, #rrggbb, #rrggbbaa — and nothing longer, so an issue number in a
// comment (radix-ui/primitives#3679) is not a colour.
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;
// A Tailwind arbitrary value: text-[#b91c1c], bg-[#fdf8ec]. Anything inside the
// brackets after the colour is kept out of rule 2 as well.
const ARBITRARY = /\[[a-z-]*#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])[^\]]*\]/g;

// A colour literal that is not a colour a token could have been named for.
// File path -> the values it may hold, and why.
const BY_VALUE_ALLOWED: Record<string, { values: string[]; why: string }> = {
  // The desk value is the stylesheet's, deliberately duplicated because a
  // stylesheet is not importable, and the test beside it fails when the two
  // drift apart. The white is the paper behind a page, painted on a canvas.
  "reading/engine/page-frame.ts": {
    values: ["#edece5", "#ffffff"],
    why: "the canvas a page is drawn on, with a test of its own against styles.css",
  },
  // The phone reader's four papers (docs/70). They are the colour of a page,
  // not of the app: three of them are a sheet and the wash multiplied over it,
  // and the dark one's surface is duplicated from the `[data-reader-paper]`
  // block in styles.css because the column is a shadow root filled by hand and
  // a stylesheet is not importable.
  "reading/epub/flow-display.ts": {
    values: ["#ffffff", "#f6efdc", "#1b1c1e"],
    why: "the paper a page is printed on, chosen in the reader rather than themed",
  },
  "reading/figures/render.ts": {
    values: ["#ffffff"],
    why: "the white a cropped figure is rasterized onto, not a foreground colour",
  },
  "reading/epub/epub-cover.ts": {
    values: ["#ffffff"],
    why: "the white a generated cover is drawn on, not a foreground colour",
  },
  "smoke/dictation-bench.tsx": {
    values: ["#b91c1c"],
    why: "a crash net that paints when the app, and possibly its stylesheet, did not come up",
  },
};

// The files that may hold a colour literal at all (rule 2), and why.
const LITERALS_ALLOWED: Record<string, string> = {
  "reading/engine/EmbedPdfView.tsx":
    "the quote highlight, handed to the PDF engine's annotation layer, which takes a colour and not a class",
  "smoke/spike-harness.tsx": "a dev harness, not a screen anyone ships",
  "smoke/aside-spike-harness.tsx": "a dev harness, not a screen anyone ships",
  "ui/components/base/icons.tsx": "an illustration's own palette",
  "ui/components/lumen/Lumen.tsx": "the companion's own palette (docs/66), which is a character and not a theme",
  "smoke/dictation-bench.tsx": "a bench page, and a crash net that cannot count on the stylesheet",
  "smoke/speech-bench.tsx": "a bench page with no stylesheet of its own",
};

function sources(ext: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (ext.some((e) => name.endsWith(e)) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
  };
  walk(src);
  return out;
}

/** Every colour the stylesheet declares, by value. */
function declaredTokens(): Map<string, string[]> {
  const css = readFileSync(join(src, "styles.css"), "utf8");
  const byValue = new Map<string, string[]>();
  for (const m of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    const value = m[2].toLowerCase();
    byValue.set(value, [...(byValue.get(value) ?? []), m[1]]);
  }
  return byValue;
}

test("the stylesheet is where the palette is declared", () => {
  const byValue = declaredTokens();
  // Guards the two rules below against a stylesheet this can no longer parse,
  // which would leave them passing with nothing to compare against.
  expect(byValue.size).toBeGreaterThan(20);
  expect([...byValue.values()].flat()).toContain("destructive");
});

test("a colour that has a token is not written out by value", () => {
  const byValue = declaredTokens();
  const offences: string[] = [];
  for (const file of sources([".ts", ".tsx"])) {
    const rel = relative(src, file);
    const allowed = BY_VALUE_ALLOWED[rel]?.values ?? [];
    for (const hit of readFileSync(file, "utf8").matchAll(HEX)) {
      const value = hit[0].toLowerCase();
      const tokens = byValue.get(value);
      if (!tokens || allowed.includes(value)) continue;
      offences.push(`${rel}: ${value} is --${tokens[0]}`);
    }
  }
  expect(offences).toEqual([]);
});

test("only a handful of files paint with a colour literal", () => {
  const offences: string[] = [];
  for (const file of sources([".tsx"])) {
    const rel = relative(src, file);
    if (LITERALS_ALLOWED[rel]) continue;
    // Arbitrary values are rule 1's business: a shade with no token of its own
    // is still allowed to be written as one (docs/37 C).
    const text = readFileSync(file, "utf8").replace(ARBITRARY, "");
    const hits = [...text.matchAll(HEX)].map((m) => m[0]);
    if (hits.length > 0) offences.push(`${rel}: ${[...new Set(hits)].join(", ")}`);
  }
  expect(offences).toEqual([]);
});
