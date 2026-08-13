// The layering of src/ enforced instead of remembered. Every .ts/.tsx file under
// src/ is scanned for relative imports, each one resolved to the entry it lands
// in, and the resulting directory graph is checked against the table below.
// Run: bun test.
//
// The layers, innermost first:
//   platform   host and storage primitives (platform/app, platform/sync).
//              platform/app is the floor and imports nothing.
//   capability headless services a domain calls into (ai/, ai/voice, budget/,
//              fulltext/). They may use platform and each other; they must
//              never reach up into a domain, because that is how ai/ ended up
//              in a cycle with four of them (reading-turn assembly used to live
//              there).
//   domain     one product area each (info/, observation/, reading/ and the units
//              inside it), free to use platform, capability and each other, as
//              long as the graph stays acyclic.
//   ui         React components (ui/components and the directories inside it).
//   shell      App.tsx and PhoneApp.tsx, the two form factors, and the only
//              places that wire ui to domains.
//   entry      main.tsx and smoke/, which pick what to boot; they may import
//              anything.
//
// Grouping must not cost the graph its resolution. A directory is a node of the
// graph at whatever depth it sits ("reading/prep", "ui/components/chat",
// "platform/sync/merge"), and a file belongs to the longest LAYER key that
// prefixes its path. Every directory holding source files needs a key of its
// own, so splitting a directory can never make the edges inside it vanish.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Layer = "platform" | "capability" | "domain" | "ui" | "shell" | "entry";

// Every directory under src/ that holds source files, at any depth, plus every
// root-level source file, and the layer each belongs to. A new directory or root
// file must be added here or the first test fails: deciding where it sits is the
// point.
const LAYER: Record<string, Layer> = {
  platform: "platform",
  "platform/app": "platform",
  "platform/sync": "platform",
  "platform/sync/merge": "platform",

  ai: "capability",
  "ai/subagent": "capability",
  "ai/voice": "capability",
  budget: "capability",
  fulltext: "capability",

  info: "domain",
  "info/briefing": "domain",
  "info/companion": "domain",
  "info/extract": "domain",
  "info/sources": "domain",
  observation: "domain",
  reading: "domain",
  "reading/engine": "domain",
  "reading/figures": "domain",
  "reading/notes": "domain",
  "reading/papers": "domain",
  "reading/prep": "domain",
  "reading/rehearsal": "domain",
  "reading/slides": "domain",
  "reading/sources": "domain",
  "reading/talks": "domain",

  ui: "ui",
  "ui/components": "ui",
  "ui/components/chat": "ui",
  "ui/components/common": "ui",
  "ui/components/info": "ui",
  "ui/components/lib": "ui",
  "ui/components/library": "ui",
  "ui/components/library/topic": "ui",
  "ui/components/phone": "ui",
  "ui/components/reader": "ui",
  "ui/components/settings": "ui",
  "ui/components/talk": "ui",
  "ui/components/ui": "ui",
  "App.tsx": "shell",
  "PhoneApp.tsx": "shell",

  "main.tsx": "entry",
  smoke: "entry",
};

// What each layer may import. Same-layer imports are always allowed; a directory
// importing itself is not an edge at all.
const MAY_IMPORT: Record<Layer, Layer[]> = {
  platform: ["platform"],
  capability: ["platform", "capability"],
  domain: ["platform", "capability", "domain"],
  ui: ["platform", "capability", "domain", "ui"],
  shell: ["platform", "capability", "domain", "ui"],
  entry: ["platform", "capability", "domain", "ui", "shell", "entry"],
};

// The cycles that were already there when this test learned to see inside
// ui/components, each with the plan item that removes it. Temporary by
// construction: the list is exact, so a pair that stops being a cycle fails the
// test as loudly as a new one appears. Delete the line with the fix, and the
// whole mechanism with the last one.
const KNOWN_CYCLES: [string, string][] = [
  // B1.1: the four dependency-free files move to ui/components/base.
  ["ui/components/common", "ui/components/ui"],
  // B1.2: Markdown and its only non-test consumer move to ui/components/markdown.
  ["ui/components/common", "ui/components/reader"],
  // B1.3: common/types.ts splits into ai/tool-status, reader/types, chat/types.
  ["ui/components/chat", "ui/components/common"],
  // B1.4: the card files move to ui/components/shelf.
  ["ui/components/library", "ui/components/library/topic"],
  ["ui/components/library", "ui/components/talk"],
  // B1.5: cardRegistry moves up to ui/components and arrives through a context.
  ["ui/components/chat", "ui/components/info"],
  ["ui/components/chat", "ui/components/reader"],
  // B1.6: PullToAsk is passed in as a render prop instead of imported.
  ["ui/components/info", "ui/components/phone"],
];

// platform/app is the floor: it imports no other entry at all.
const LEAF = "platform/app";
// The ui layer and the shell are reachable only from the shell and the entry
// point.
const UI_ONLY = Object.keys(LAYER).filter((d) => LAYER[d] === "ui" || LAYER[d] === "shell");

const SRC = fileURLToPath(new URL("../src", import.meta.url));

interface Edge {
  from: string;
  to: string;
  // Where the edge comes from, for the failure message.
  file: string;
  spec: string;
}

// Co-located tests are excluded: a test may reach anywhere it needs to. .d.ts
// files declare ambient types and import nothing structural.
function isSourceName(name: string): boolean {
  return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name);
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      out.push(...sourceFiles(p));
      continue;
    }
    if (isSourceName(entry)) out.push(p);
  }
  return out;
}

// Static imports, `export ... from`, bare side-effect imports and dynamic
// import() all count. So do `import type` / `type` specifiers: a type import is
// still a compile-time dependency on another directory's shape, which is the
// coupling this test is about, even though it leaves no runtime edge.
// Comments are not stripped, so a commented-out import counts too; the failure
// message names the file and the specifier, so that reads as what it is.
const IMPORT_RE = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;

// The node a path under src/ belongs to: the longest LAYER key that prefixes it
// at a segment boundary. src/ui/components/library/topic/X.tsx lands on
// "ui/components/library/topic" and not on "ui/components/library", so a
// directory becomes a node of its own the moment it is registered. A path with
// no registered ancestor falls back to its first segment, which is not in LAYER
// either, so the first test names it instead of the graph swallowing it.
function entryOf(rel: string): string {
  const parts = rel.split("/");
  for (let n = parts.length; n > 0; n--) {
    const key = parts.slice(0, n).join("/");
    if (key in LAYER) return key;
  }
  return parts[0];
}

// A specifier resolved to the node under src/ it lands in, or null when it
// leaves src/ or points at a non-source asset.
//
// The trap: a specifier carries no extension, so a barrel import of a directory
// ("../observation") and an import of a file ("../App") look alike, and the path
// that goes into entryOf differs — "observation" against "App.tsx". Telling them
// apart takes a real stat, not a count of slashes.
function resolveEntry(fromFile: string, spec: string): string | null {
  // `@/x` is the alias the shadcn CLI writes into a generated component; it
  // means src/x. Resolved here rather than skipped, or an aliased import would
  // be a hole in every rule below.
  const abs = spec.startsWith("@/")
    ? resolve(SRC, spec.slice(2))
    : resolve(dirname(fromFile), spec);
  const rel = relative(SRC, abs);
  if (rel === "" || rel.startsWith("..")) return null;
  if (isDir(abs)) return entryOf(rel);
  for (const ext of [".ts", ".tsx"]) {
    if (isFile(abs + ext)) return entryOf(rel + ext);
  }
  // A specifier that already carries its extension still counts; anything else
  // is an asset such as styles.css and no part of the module graph.
  if (isSourceName(rel) && isFile(abs)) return entryOf(rel);
  return null;
}

function collectEdges(): Edge[] {
  const edges: Edge[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file);
    const from = entryOf(rel);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1];
      if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;
      const to = resolveEntry(file, spec);
      if (to === null || to === from) continue;
      edges.push({ from, to, file: `src/${rel}`, spec });
    }
  }
  return edges;
}

const EDGES = collectEdges();
// The layer rules only apply to edges whose both ends have a declared layer; an
// undeclared entry is reported by its own test instead of crashing the others.
const DECLARED = EDGES.filter((e) => e.from in LAYER && e.to in LAYER);

// Every path that needs a key in LAYER: the root-level source files, plus every
// directory holding source files at any depth. The recursion is the point — a
// directory that is split has to register its parts before their edges count,
// instead of the new subdirectories folding back into the parent and their
// imports of each other disappearing.
//
// Pushes each directory that holds source files anywhere below it and returns
// whether it does.
function collectDirs(dir: string, out: string[]): boolean {
  let hasSource = false;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (collectDirs(p, out)) {
        out.push(relative(SRC, p));
        hasSource = true;
      }
      continue;
    }
    if (isSourceName(entry)) hasSource = true;
  }
  return hasSource;
}

function declaredEntries(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(SRC)) {
    if (!statSync(join(SRC, entry)).isDirectory() && isSourceName(entry)) out.push(entry);
  }
  collectDirs(SRC, out);
  return [...new Set(out)].sort();
}

function describe(edges: Edge[]): string {
  return edges.map((e) => `      ${e.file} imports "${e.spec}"`).join("\n");
}

function edgesFor(from: string, to: string): Edge[] {
  return EDGES.filter((e) => e.from === from && e.to === to);
}

const ADJ = new Map<string, Set<string>>();
for (const e of EDGES) {
  if (!ADJ.has(e.from)) ADJ.set(e.from, new Set());
  ADJ.get(e.from)!.add(e.to);
}

// A pair is named the same way whichever end is met first.
function pairKey(a: string, b: string): string {
  return a < b ? `${a} <-> ${b}` : `${b} <-> ${a}`;
}

// The two-directory cycles: a imports b and b imports a. Every longer cycle in
// this codebase is made of these, so they are checked by name against
// KNOWN_CYCLES and folded away before the search for the rest.
function mutualPairs(): Map<string, [string, string]> {
  const found = new Map<string, [string, string]>();
  for (const [from, tos] of ADJ) {
    for (const to of tos) {
      if (ADJ.get(to)?.has(from)) found.set(pairKey(from, to), from < to ? [from, to] : [to, from]);
    }
  }
  return found;
}

// Union-find over the allowlisted pairs, so each pair is one node for the cycle
// search. Returns the representative of a node.
function fold(pairs: [string, string][]): (node: string) => string {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x);
    if (p === undefined || p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  for (const [a, b] of pairs) {
    const [lo, hi] = [find(a), find(b)].sort();
    if (lo !== hi) parent.set(hi, lo);
  }
  return find;
}

// These messages name every offending file and specifier, so they are thrown
// rather than handed to expect(): a diff escapes the newlines and the message
// arrives as one unreadable line.
function reject(message: string): never {
  throw new Error(`\n${message}\n`);
}

test("every entry under src/ has a declared layer", () => {
  const undeclared = declaredEntries().filter((entry) => !(entry in LAYER));
  if (undeclared.length > 0) {
    reject(
      `Not in the LAYER table in tests/layering.test.ts:\n` +
        undeclared.map((e) => `  src/${e}`).join("\n") +
        "\nPick the layer each one belongs to and add it, so its imports get checked.",
    );
  }
  expect(undeclared).toEqual([]);
});

test("the directories that import each other are exactly the known ones", () => {
  const found = mutualPairs();
  const known = new Map(KNOWN_CYCLES.map(([a, b]) => [pairKey(a, b), [a, b] as [string, string]]));

  const fixed = [...known.keys()].filter((k) => !found.has(k));
  if (fixed.length > 0) {
    reject(
      `No longer a cycle, so it must not stay on the KNOWN_CYCLES allowlist in ` +
        `tests/layering.test.ts:\n${fixed.map((k) => `  ${k}`).join("\n")}\n` +
        "Delete the line. The list is exact on purpose: a stale entry would let the cycle " +
        "come back unnoticed.",
    );
  }

  const surprises = [...found.entries()].filter(([k]) => !known.has(k));
  if (surprises.length > 0) {
    reject(
      `${surprises.length} pair(s) of directories import each other:\n\n` +
        surprises
          .map(([k, [a, b]]) =>
            [
              k,
              `  ${a} -> ${b}`,
              describe(edgesFor(a, b)),
              `  ${b} -> ${a}`,
              describe(edgesFor(b, a)),
            ].join("\n"),
          )
          .join("\n\n") +
        "\n\nNeither side can be read, tested or moved on its own. Split by what does not need " +
        "to know what, and lift the shared half to a directory both sides already depend on.",
    );
  }
  expect(surprises.map(([k]) => k)).toEqual([]);
});

test("the directory dependency graph is acyclic", () => {
  // Each allowlisted pair counts as one node here: the test above reports it by
  // name, and folding it keeps every longer path that merely runs through it out
  // of this report. A cycle that leaves the pair still shows up.
  const find = fold(KNOWN_CYCLES);
  const members = new Map<string, string[]>();
  for (const node of new Set(EDGES.flatMap((e) => [e.from, e.to]))) {
    members.set(find(node), [...(members.get(find(node)) ?? []), node].sort());
  }
  const label = (node: string): string => (members.get(node) ?? [node]).join(" + ");
  const edgesBetween = (from: string, to: string): Edge[] =>
    EDGES.filter((e) => find(e.from) === from && find(e.to) === to);

  const out = new Map<string, Set<string>>();
  for (const e of EDGES) {
    const [from, to] = [find(e.from), find(e.to)];
    if (from === to) continue;
    if (!out.has(from)) out.set(from, new Set());
    out.get(from)!.add(to);
  }

  // DFS with a gray stack. Every back-edge yields one concrete cycle; that is
  // enough to name the problem without enumerating every elementary cycle.
  const gray = new Set<string>();
  const done = new Set<string>();
  const stack: string[] = [];
  const reports = new Map<string, string>();

  function report(cycle: string[]): void {
    // Rotate to the smallest member so the same cycle is reported once.
    const lo = cycle.indexOf([...cycle].sort()[0]);
    const path = [...cycle.slice(lo), ...cycle.slice(0, lo)];
    const key = path.map(label).join(" -> ");
    if (reports.has(key)) return;
    const lines = [`Directory dependency cycle: ${key} -> ${label(path[0])}`];
    for (let i = 0; i < path.length; i++) {
      const from = path[i];
      const to = path[(i + 1) % path.length];
      lines.push(`  ${label(from)} -> ${label(to)}`, describe(edgesBetween(from, to)));
    }
    reports.set(key, lines.join("\n"));
  }

  function visit(node: string): void {
    gray.add(node);
    stack.push(node);
    for (const next of out.get(node) ?? []) {
      if (gray.has(next)) report(stack.slice(stack.indexOf(next)));
      else if (!done.has(next)) visit(next);
    }
    stack.pop();
    gray.delete(node);
    done.add(node);
  }

  for (const node of [...out.keys()].sort()) if (!done.has(node)) visit(node);

  if (reports.size > 0) {
    reject(
      `${reports.size} cycle(s) between src/ directories:\n\n${[...reports.values()].join("\n\n")}\n\n` +
        "A cycle means neither side can be read, tested or moved on its own. Push the " +
        "shared piece down to a layer both sides already depend on.",
    );
  }
  expect([...reports.keys()]).toEqual([]);
});

test("platform/app is a leaf and imports no other src/ entry", () => {
  const escaping = EDGES.filter((e) => e.from === LEAF);
  if (escaping.length > 0) {
    reject(
      `src/${LEAF} is the floor everything stands on and must import nothing else under src/:\n` +
        describe(escaping),
    );
  }
  expect(escaping).toEqual([]);
});

test("capability layers import no domain, ui or shell code", () => {
  const capabilities = Object.keys(LAYER).filter((d) => LAYER[d] === "capability");
  const bad = DECLARED.filter(
    (e) => LAYER[e.from] === "capability" && !MAY_IMPORT.capability.includes(LAYER[e.to]),
  );
  if (bad.length > 0) {
    reject(
      `${capabilities.map((c) => `src/${c}`).join(" and ")} are headless capabilities: a domain ` +
        "calls them, they never call a domain.\n" +
        describe(bad) +
        "\nMove the orchestration into the domain that owns it.",
    );
  }
  expect(bad).toEqual([]);
});

// Spelled out rather than left to the layer table, which lets a capability import
// a capability, and to the acyclic test, which only rejects budget -> ai for as
// long as ai -> budget happens to exist. The direction is the point: everything
// on the sending path has to be able to import budget, so budget must be able to
// stand without ai.
test("budget imports nothing from ai", () => {
  const bad = EDGES.filter((e) => e.from === "budget" && (e.to === "ai" || e.to.startsWith("ai/")));
  if (bad.length > 0) {
    reject(
      "src/budget is what the send path asks before it spends, so it sits below src/ai " +
        "and never calls into it:\n" +
        describe(bad) +
        "\nMove the piece budget needs into a module both can import.",
    );
  }
  expect(bad).toEqual([]);
});

test("ui/components and App.tsx are imported only by the shell and the entry point", () => {
  const bad = DECLARED.filter(
    (e) => UI_ONLY.includes(e.to) && !["ui", "shell", "entry"].includes(LAYER[e.from]),
  );
  if (bad.length > 0) {
    reject(
      `Only App.tsx and the entry point may reach into ${UI_ONLY.map((u) => `src/${u}`).join(" or ")}:\n` +
        describe(bad) +
        "\nLogic a component needs belongs in a .ts module the component imports, not the" +
        " other way round.",
    );
  }
  expect(bad).toEqual([]);
});

test("every cross-directory import is allowed by the layer table", () => {
  const bad = DECLARED.filter((e) => !MAY_IMPORT[LAYER[e.from]].includes(LAYER[e.to]));
  if (bad.length > 0) {
    reject(
      "Imports that cross a layer the wrong way:\n" +
        bad
          .map(
            (e) =>
              `  ${e.from} (${LAYER[e.from]}) -> ${e.to} (${LAYER[e.to]})\n` +
              `      ${e.file} imports "${e.spec}"`,
          )
          .join("\n"),
    );
  }
  expect(bad).toEqual([]);
});
