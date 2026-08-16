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

// Every directory under src/ that holds source files anywhere below it, at any
// depth, plus every root-level source file, and the layer each belongs to. A
// grouping directory whose own source sits only in subdirectories is registered
// too. A new directory or root file must be added here or the first test fails:
// deciding where it sits is the point.
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
  "info/briefing/speech": "domain",
  "info/companion": "domain",
  "info/extract": "domain",
  "info/sources": "domain",
  observation: "domain",
  "observation/distill": "domain",
  "observation/profile": "domain",
  "observation/record": "domain",
  reading: "domain",
  "reading/engine": "domain",
  "reading/engine/gesture": "domain",
  "reading/figures": "domain",
  "reading/notes": "domain",
  "reading/papers": "domain",
  "reading/prep": "domain",
  "reading/rehearsal": "domain",
  "reading/session": "domain",
  "reading/slides": "domain",
  "reading/sources": "domain",
  "reading/talks": "domain",

  ui: "ui",
  "ui/components": "ui",
  "ui/components/base": "ui",
  "ui/components/chat": "ui",
  "ui/components/common": "ui",
  "ui/components/info": "ui",
  "ui/components/lib": "ui",
  "ui/components/library": "ui",
  "ui/components/library/topic": "ui",
  "ui/components/markdown": "ui",
  "ui/components/phone": "ui",
  "ui/components/reader": "ui",
  "ui/components/settings": "ui",
  "ui/components/shelf": "ui",
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

test("the directory dependency graph is acyclic", () => {
  // Every edge counts, including the two of a pair that import each other: a
  // mutual pair is a cycle of length two and gets reported as one.
  const out = new Map<string, Set<string>>();
  for (const e of EDGES) {
    if (!out.has(e.from)) out.set(e.from, new Set());
    out.get(e.from)!.add(e.to);
  }

  // DFS with a gray stack. Every back-edge yields one concrete cycle; that is
  // enough to name the problem without enumerating every elementary cycle.
  const gray = new Set<string>();
  const done = new Set<string>();
  const stack: string[] = [];
  const reports = new Map<string, string>();

  function report(cycle: string[]): void {
    // Rotate to the smallest node so the same cycle is reported once.
    const lo = cycle.indexOf([...cycle].sort()[0]);
    const path = [...cycle.slice(lo), ...cycle.slice(0, lo)];
    const key = path.join(" -> ");
    if (reports.has(key)) return;
    const lines = [`Directory dependency cycle: ${key} -> ${path[0]}`];
    for (let i = 0; i < path.length; i++) {
      const from = path[i];
      const to = path[(i + 1) % path.length];
      lines.push(`  ${from} -> ${to}`, describe(edgesFor(from, to)));
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

// The PDFium engine's own API, as opposed to the layer table's relative
// imports. reading/covers.ts used to drive the engine itself, which is how two
// of the three quirks this project has paid for (pitfalls 21 and 102) came to
// be recorded in two directories at once. src/reading/engine owns the vocabulary;
// everyone else asks it for a page. smoke/ is exempt: it boots the engine
// directly to check the wasm is there.
const ENGINE_ONLY_PACKAGE = "@embedpdf/";
const ENGINE_PACKAGE_OWNERS = ["reading/engine", "smoke"];

test("only src/reading/engine imports @embedpdf", () => {
  const bad = sourceFiles(SRC)
    .map((file) => relative(SRC, file))
    .filter((rel) => !ENGINE_PACKAGE_OWNERS.some((dir) => rel.startsWith(`${dir}/`)))
    .filter((rel) =>
      [...readFileSync(join(SRC, rel), "utf8").matchAll(IMPORT_RE)].some((m) =>
        m[1].startsWith(ENGINE_ONLY_PACKAGE),
      ),
    );
  if (bad.length > 0) {
    reject(
      `Only ${ENGINE_PACKAGE_OWNERS.map((d) => `src/${d}`).join(" and ")} may import @embedpdf:\n` +
        bad.map((rel) => `  src/${rel}`).join("\n") +
        "\nThe engine's quirks are recorded in one directory; ask src/reading/engine for what" +
        " you need instead of opening a document yourself.",
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
