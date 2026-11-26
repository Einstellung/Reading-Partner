import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
const root = process.argv[2];
const mode = process.argv[3] ?? "report";
const src = join(root, "src");
const files: string[] = [];
function walk(d: string) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(n)) files.push(p);
  }
}
walk(src);
walk(join(root, "tests"));
function res(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(from), spec);
  for (const c of [base, base + ".ts", base + ".tsx", join(base, "index.ts"), join(base, "index.tsx")])
    if (existsSync(c) && statSync(c).isFile()) return c;
  return base + " (MISSING)";
}
const re = /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']|mock\.module\(\s*["']([^"']+)["']/g;
const edges: [string, string][] = [];
for (const f of files) {
  const t = readFileSync(f, "utf8");
  let m;
  while ((m = re.exec(t))) {
    const s = m[1] || m[2] || m[3] || m[4];
    const r = res(f, s);
    if (r) edges.push([relative(root, f), relative(root, r)]);
  }
}
const isInfo = (p: string) => p.startsWith("src/info/") || p.startsWith("tests/info/");
const isMeals = (p: string) => p.startsWith("src/info/meals") || p.startsWith("tests/info/meals");
const group = (title: string, pred: (a: string, b: string) => boolean) => {
  console.log("== " + title);
  const s = new Map<string, Set<string>>();
  for (const [a, b] of edges) if (pred(a, b)) { if (!s.has(b)) s.set(b, new Set()); s.get(b)!.add(a); }
  for (const b of [...s.keys()].sort()) console.log(b, "<-", [...s.get(b)!].sort().join(" "));
};
if (mode === "report") {
  group("meals -> other info", (a, b) => isMeals(a) && b.startsWith("src/info/") && !isMeals(b));
  group("non-info -> info (non-meals)", (a, b) => !isInfo(a) && b.startsWith("src/info/") && !isMeals(b));
} else if (mode === "missing") {
  for (const [a, b] of edges) if (b.endsWith("(MISSING)")) console.log(a, "->", b);
} else if (mode === "closure") {
  // transitive closure of info deps from seeds given in argv[4..]
  const seeds = process.argv.slice(4);
  const seen = new Set<string>(seeds);
  const q = [...seeds];
  while (q.length) {
    const x = q.pop()!;
    for (const [a, b] of edges) if (a === x && (b.startsWith("src/info/") || b.startsWith("src/ui/components/info/")) && !seen.has(b)) { seen.add(b); q.push(b); }
  }
  console.log([...seen].sort().join("\n"));
}
