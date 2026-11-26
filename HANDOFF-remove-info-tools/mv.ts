// Usage: bun mv.ts <root> <moves.json> [--dry]
// moves.json: [[oldRel, newRel], ...] — files or directories, relative to root.
// Rewrites every relative import in src/, tests/, scripts/ so it points at the
// moved location, then runs `git mv` for each move.
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(process.argv[2]);
const moves: [string, string][] = JSON.parse(readFileSync(process.argv[3], "utf8"));
const dry = process.argv.includes("--dry");
const absMoves = moves.map(([a, b]) => [join(root, a), join(root, b)] as const);

function newPathOf(p: string): string {
  for (const [a, b] of absMoves) {
    if (p === a) return b;
    if (p.startsWith(a + sep)) return b + p.slice(a.length);
  }
  return p;
}

const files: string[] = [];
function walk(d: string) {
  if (!existsSync(d)) return;
  for (const n of readdirSync(d)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(n)) files.push(p);
  }
}
for (const d of ["src", "tests", "scripts"]) walk(join(root, d));

const SUFFIXES = ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx"];
function resolveSpec(from: string, spec: string): { file: string; suffix: string } | null {
  const base = resolve(dirname(from), spec);
  for (const s of SUFFIXES) {
    const c = base + s;
    if (existsSync(c) && statSync(c).isFile()) return { file: c, suffix: s };
  }
  return null;
}

const re = /(from\s*|import\s*\(\s*|import\s+|mock\.module\(\s*|require\(\s*)(["'])(\.{1,2}\/[^"']*)\2/g;
let changedFiles = 0;
for (const f of files) {
  const text = readFileSync(f, "utf8");
  const newF = newPathOf(f);
  const out = text.replace(re, (whole, pre, q, spec) => {
    const r = resolveSpec(f, spec);
    if (!r) return whole;
    const newTarget = newPathOf(r.file);
    if (newTarget === r.file && newF === f) return whole;
    let base = newTarget.slice(0, newTarget.length - r.suffix.length);
    let rel = relative(dirname(newF), base).split(sep).join("/");
    if (!rel.startsWith(".")) rel = "./" + rel;
    if (spec.endsWith("/") && !rel.endsWith("/")) rel += "/";
    return `${pre}${q}${rel}${q}`;
  });
  if (out !== text) {
    changedFiles++;
    if (!dry) writeFileSync(f, out);
  }
}
console.log("rewrote", changedFiles, "files");
if (!dry) {
  for (const [a, b] of moves) {
    mkdirSync(dirname(join(root, b)), { recursive: true });
    execFileSync("git", ["-C", root, "mv", a, b], { stdio: "inherit" });
  }
}
