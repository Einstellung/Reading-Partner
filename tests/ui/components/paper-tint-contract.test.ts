// The paper tint is a palette swap and nothing else: one block of token
// overrides under `[data-tint="paper"]`, and every surface in the app reaching
// its colour through a token. That second half is the fragile one. A single
// `bg-white` left in a component is a white card sitting in a cream app, and it
// costs nothing to write and nothing to notice — this file is here to make it
// cost a failing test.
//
// The tokens are checked too, because the tint is worthless if the ladder they
// form comes apart: the chat window is three stacked layers and only their
// order makes it read as one.
//
// Source text rather than a render: these are Tailwind classes and CSS custom
// properties, neither of which jsdom resolves. Run: bun test.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

// Comments out, both forms: a comment explaining why a colour was chosen names
// the class it replaced, and a scan that counted those would make the rule
// unexplainable. `/* */` covers the JSX form too, which is that wrapped in
// braces.
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

const styles = readFileSync(join(SRC, "styles.css"), "utf8");

// The relative brightness of the palette, not the exact hexes: a value can be
// nudged, the order it sits in cannot. Sorted brightest first, and the same
// order has to hold in both palettes.
const LADDER = ["--background", "--chat-surface", "--chat-code", "--chat-bubble"];

// The two weight ramps, also brightest first. They are what the components
// outside the chat window are painted from, and their steps carry meaning: a
// chip has to sit deeper than the panel it is on, a row divider has to stay
// lighter than the rule that opens the list. Warming them one by one is how
// two of those steps get swapped by accident.
const RAMPS = [
  ["--muted-faint", "--muted-soft", "--muted", "--muted-strong"],
  ["--border-faint", "--border-subtle", "--border-soft", "--border"],
];

// The block a variable is declared in. The paper block is the tail of the base
// layer, so cutting the file at its opening selector separates the two.
function paletteBlocks(): { base: string; paper: string } {
  const at = styles.indexOf('[data-tint="paper"]');
  expect(at).toBeGreaterThan(0);
  return { base: styles.slice(0, at), paper: styles.slice(at) };
}

function hex(block: string, token: string): string {
  const match = new RegExp(`${token}:\\s*(#[0-9a-f]{6})`).exec(block);
  if (!match) throw new Error(`${token} is not declared`);
  return match[1];
}

// Perceived brightness is not needed: every value here is a near-neutral, so the
// channel sum orders them the way an eye does.
function brightness(value: string): number {
  const n = Number.parseInt(value.slice(1), 16);
  return (n >> 16) + ((n >> 8) & 0xff) + (n & 0xff);
}

test("the tint is one attribute with one value, declared after the defaults", () => {
  const { base, paper } = paletteBlocks();
  // Off is the attribute being absent. A second value (`data-tint="none"`) would
  // make every rule that wants the default palette carry a :not().
  expect(styles).not.toMatch(/\[data-tint="(?!paper")/);
  // Same specificity as :root, so source order is the whole of why it wins.
  expect(base).toContain(":root {");
  expect(paper.indexOf("--background:")).toBeGreaterThan(0);
});

test("the reading ladder keeps its order in both palettes", () => {
  const { base, paper } = paletteBlocks();
  for (const block of [base, paper]) {
    const steps = LADDER.map((token) => brightness(hex(block, token)));
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeLessThan(steps[i - 1]);
    }
  }
});

test("the neutral fill and rule ramps keep their order in both palettes", () => {
  const { base, paper } = paletteBlocks();
  for (const ramp of RAMPS) {
    for (const block of [base, paper]) {
      const steps = ramp.map((token) => brightness(hex(block, token)));
      for (let i = 1; i < steps.length; i++) {
        expect(steps[i]).toBeLessThan(steps[i - 1]);
      }
    }
  }
});

test("every tinted token is warmer and darker than the white it replaces", () => {
  const { base, paper } = paletteBlocks();
  const tinted = [
    "--background",
    "--card",
    "--popover",
    "--muted",
    "--accent",
    "--border",
    "--input",
    ...LADDER,
    ...RAMPS.flat(),
  ];
  for (const token of new Set(tinted)) {
    const before = Number.parseInt(hex(base, token).slice(1), 16);
    const after = Number.parseInt(hex(paper, token).slice(1), 16);
    const blue = (v: number) => v & 0xff;
    const red = (v: number) => v >> 16;
    // Warmer: less blue than red. A neutral grey left in place is what reads as
    // cold against the rest, which is why --muted and --accent are in this list.
    expect(blue(after)).toBeLessThan(red(after));
    expect(brightness(`#${after.toString(16).padStart(6, "0")}`)).toBeLessThan(
      brightness(`#${before.toString(16).padStart(6, "0")}`),
    );
  }
});

test("the page wash defaults to transparent at the root, not only under the tint", () => {
  const { base, paper } = paletteBlocks();
  // The reader reads this as `var(--page-wash, transparent)` from another
  // branch. The fallback and the declared default have to agree, and the
  // declared one is the one a stylesheet can be read off.
  expect(base).toContain("--page-wash: transparent;");
  expect(hex(paper, "--page-wash")).toBe("#f6efdc");
});

test("the tint is applied before React mounts", () => {
  const main = readFileSync(join(SRC, "main.tsx"), "utf8");
  const applied = main.indexOf("initPaperTint(window)");
  const mounted = main.indexOf("createRoot");
  expect(applied).toBeGreaterThan(0);
  expect(applied).toBeLessThan(mounted);
});

// The one exemption, by file and by exact class. A rehearsal is a projected
// deck on near-black chrome, and a tenth of white is how a control lights up on
// it; a palette token would put a cream fill there. Kept as the full class
// string rather than the file name so a plain `bg-white` added to the same file
// still fails.
const WHITE_ALLOWED = new Map([["ui/components/talk/RehearsalView.tsx", ["bg-white/10"]]]);

test("nothing in the UI paints itself white outside the palette", () => {
  const offenders: string[] = [];
  for (const path of sources(join(SRC, "ui"))) {
    const relative = path.slice(SRC.length + 1);
    const allowed = WHITE_ALLOWED.get(relative) ?? [];
    for (const match of code(path).matchAll(/bg-white(\/\d+)?/g)) {
      if (!allowed.includes(match[0])) offenders.push(`${relative}: ${match[0]}`);
    }
  }
  expect(offenders).toEqual([]);
});

test("nothing in the UI writes a white hex either", () => {
  const offenders: string[] = [];
  for (const path of sources(join(SRC, "ui"))) {
    // The arbitrary-value and inline-style ways around the class above.
    for (const match of code(path).matchAll(/#fff(fff)?\b/gi)) {
      offenders.push(`${path.slice(SRC.length + 1)}: ${match[0]}`);
    }
  }
  expect(offenders).toEqual([]);
});

// A fill this pale is one of two things. Either it is the palette's own
// neutral, in which case it has a token and must use it, or it is a state
// colour thinned almost to white — the violet of a chip, the amber of a note,
// the green of a confirmation, the red of a warning — which carries meaning a
// neutral token would erase. Only the second kind belongs here, and it is
// listed by file and by exact class so a plain grey added to the same file
// still fails.
const PALE_ALLOWED = new Map([
  ["ui/components/info/ArticleView.tsx", ["bg-[#eff6f0]"]],
  ["ui/components/info/BriefingPage.tsx", ["bg-[#f0eefb]", "bg-[#fdf8ee]"]],
  ["ui/components/info/InfoCards.tsx", ["bg-[#faf9ff]", "bg-[#fdf5f3]", "bg-[#f8e8e4]"]],
  ["ui/components/library/SavedArticleView.tsx", ["bg-[#fdf8ec]"]],
  ["ui/components/markdown/MarkdownRenderer.tsx", ["bg-[#efecfb]", "bg-[#f6f4fd]"]],
  ["ui/components/phone/PullToAsk.tsx", ["bg-[#f4f2fc]"]],
  ["ui/components/reader/MoreMenu.tsx", ["bg-[#efecfb]"]],
  ["ui/components/ui/badge.tsx", ["bg-[#f0eefb]"]],
]);

// 0xe0 is the line: every neutral this palette owns is above it (--muted-strong
// is the deepest at #e5e5e5) and every fill below it is dark enough to read as
// a shape rather than as the page.
const PALE = 0xe0;

function channels(value: string): number[] {
  const full = value.length === 4 ? value.replace(/[0-9a-f]/gi, "$&$&") : value;
  const n = Number.parseInt(full.slice(1), 16);
  return [n >> 16, (n >> 8) & 0xff, n & 0xff];
}

test("nothing in the UI fills itself near-white outside the palette", () => {
  const offenders: string[] = [];
  for (const path of sources(join(SRC, "ui"))) {
    const relative = path.slice(SRC.length + 1);
    const allowed = PALE_ALLOWED.get(relative) ?? [];
    const text = code(path);
    // Tailwind's own light neutrals are the other way to write the greys this
    // palette replaced, and they answer to no token at all.
    for (const match of text.matchAll(/bg-(?:neutral|gray|slate|zinc|stone)-(?:50|100|200)\b/g)) {
      offenders.push(`${relative}: ${match[0]}`);
    }
    for (const match of text.matchAll(/bg-\[(#[0-9a-f]{3}|#[0-9a-f]{6})\]/gi)) {
      if (allowed.includes(match[0])) continue;
      if (channels(match[1].toLowerCase()).every((c) => c >= PALE)) offenders.push(`${relative}: ${match[0]}`);
    }
  }
  expect(offenders).toEqual([]);
});
