// The layering of src/ enforced instead of remembered. Every .ts/.tsx file under
// src/ is scanned for relative imports, each one resolved to the entry it lands
// in, and the resulting directory graph is checked against the table below.
// Run: bun test.
//
// The layers, innermost first:
//   platform   host and storage primitives (platform/app, platform/sync).
//              platform/app is the floor and imports nothing.
//   capability headless services a domain calls into (ai/, ai/voice,
//              fulltext/). They may use platform and each other; they must
//              never reach up into a domain, because that is how ai/ ended up
//              in a cycle with four of them (reading-turn assembly used to live
//              there).
//   domain     one product area each, free to use platform, capability and each
//              other, as long as the graph stays acyclic.
//   ui         React components (components/).
//   shell      App.tsx, the one place that wires ui to domains.
//   entry      main.tsx and smoke/, which pick what to boot; they may import
//              anything.
//
// A planned regrouping folds these directories into platform/ (done), ai/
// (done), memory/, fulltext/, reading/ (absorbing prep, notes, figures, slides,
// reader-embedpdf), info/ and ui/ (components). Grouping must not cost the
// graph its resolution, so a LAYER key may name a unit inside a grouping
// directory ("platform/app") and the graph keeps a node per unit. When the
// regrouping lands, this test needs edits to LAYER only.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Layer = "platform" | "capability" | "domain" | "ui" | "shell" | "entry";

// Every entry under src/ and the layer it belongs to. A key is either a
// top-level entry ("memory", "App.tsx") or, when a top-level directory groups
// several units, one of those units ("platform/app"); a grouping directory
// keeps a key of its own for the files sitting directly in it. A new directory
// or root file must be added here or the first test fails: deciding where it
// sits is the point.
const LAYER: Record<string, Layer> = {
  platform: "platform",
  "platform/app": "platform",
  "platform/sync": "platform",

  ai: "capability",
  "ai/voice": "capability",
  fulltext: "capability",

  figures: "domain",
  info: "domain",
  memory: "domain",
  notes: "domain",
  prep: "domain",
  reading: "domain",
  "reading/engine": "domain",
  slides: "domain",

  components: "ui",
  "App.tsx": "shell",

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

// A top-level directory whose subdirectories are units in their own right, so
// an import into one of them is an edge to that unit rather than to the group.
// Derived from the two-segment keys above, so registering a unit is enough.
const GROUPS = new Set(
  Object.keys(LAYER)
    .filter((k) => k.includes("/"))
    .map((k) => k.split("/")[0]),
);

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

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      out.push(...sourceFiles(p));
      continue;
    }
    // Co-located tests are excluded: a test may reach anywhere it needs to.
    // .d.ts files declare ambient types and import nothing structural.
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry) || /\.d\.ts$/.test(entry)) continue;
    out.push(p);
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

// The entry a source file belongs to: its top-level entry, or the unit that
// holds it when it sits inside a grouping directory.
function entryOf(rel: string): string {
  const parts = rel.split("/");
  if (parts.length > 2 && GROUPS.has(parts[0])) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

// A specifier resolved to the entry under src/ it lands in, or null when it
// leaves src/ or points at a non-source asset.
//
// The trap: a barrel import like "../memory" resolves to the directory
// src/memory, not to a root-level file. Both look like a single path segment,
// so the directory check has to be a real stat, not a count of slashes. Two
// segments inside a grouping directory are ambiguous the same way —
// "reading/prep" is a unit, "reading/turn" is a file of the group itself — and
// need the same stat.
function resolveEntry(fromFile: string, spec: string): string | null {
  const abs = resolve(dirname(fromFile), spec);
  const rel = relative(SRC, abs);
  if (rel === "" || rel.startsWith("..")) return null;
  const parts = rel.split("/");
  const head = parts[0];
  if (parts.length > 1) {
    if (!GROUPS.has(head)) return head;
    if (parts.length > 2) return `${head}/${parts[1]}`;
    try {
      if (statSync(abs).isDirectory()) return `${head}/${parts[1]}`;
    } catch {
      // Not a directory: a file of the grouping directory itself.
    }
    return head;
  }
  try {
    if (statSync(abs).isDirectory()) return head;
  } catch {
    // Not a directory; fall through to the root-file case.
  }
  for (const ext of [".ts", ".tsx"]) {
    try {
      if (statSync(abs + ext).isFile()) return head + ext;
    } catch {
      // Try the next extension.
    }
  }
  // A root-level asset such as styles.css: not part of the module graph.
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
      if (!spec.startsWith(".")) continue;
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

// Every entry that needs a key in LAYER: the top-level ones, plus the
// subdirectories of a grouping directory.
function declaredEntries(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(SRC)) {
    if (!statSync(join(SRC, entry)).isDirectory()) {
      if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
        out.push(entry);
      }
      continue;
    }
    out.push(entry);
    if (!GROUPS.has(entry)) continue;
    for (const sub of readdirSync(join(SRC, entry))) {
      if (statSync(join(SRC, entry, sub)).isDirectory()) out.push(`${entry}/${sub}`);
    }
  }
  return out;
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
    // Rotate to the smallest member so the same cycle is reported once.
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

test("components/ and App.tsx are imported only by the shell and the entry point", () => {
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
