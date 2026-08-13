// The deferred readable extractor (src/info/extract/readable-lazy.ts).
//
// Two things are being protected. One is the bundle shape: Readability and
// defuddle are ~355 kB minified and used only when a fetched page is turned into
// an article, so readable.ts must be reachable from src/ through a dynamic
// import and nothing else — a single static edge folds it back into whichever
// chunk imported it, silently, with a green build. The other is that deferring
// it did not break it: the module really loads and really extracts.
//
// Run: bun test.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { useDom } from "../support/dom";

// A window before the extractor's chunk is pulled in: readable.ts runs
// DOMParser, Readability and defuddle, none of which exist headless. The
// dynamic import happens inside the test, after this has run.
await useDom();

import { cacheUntilFailure, loadExtractReadable } from "../../src/info/extract/readable-lazy";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const TARGET = resolve(SRC, "info/extract/readable.ts");
const DOOR = resolve(SRC, "info/extract/readable-lazy.ts");

// Same shape as tests/layering.test.ts's scanner, plus the one distinction that
// matters here: whether the specifier came through `import(` or not.
const IMPORT_RE = /(?:\bfrom|\bimport)\s*(\(?)\s*["']([^"']+)["']/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

function resolveSpec(fromFile: string, spec: string): string | null {
  const abs = spec.startsWith("@/") ? resolve(SRC, spec.slice(2)) : resolve(dirname(fromFile), spec);
  for (const cand of [abs, abs + ".ts", abs + ".tsx"]) {
    try {
      if (statSync(cand).isFile()) return cand;
    } catch {
      // Not a file: a directory import or an asset, neither of which is readable.ts.
    }
  }
  return null;
}

function edgesToExtractor(): { file: string; dynamic: boolean }[] {
  const found: { file: string; dynamic: boolean }[] = [];
  for (const file of sourceFiles(SRC)) {
    for (const m of readFileSync(file, "utf8").matchAll(IMPORT_RE)) {
      const spec = m[2];
      if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;
      if (resolveSpec(file, spec) === TARGET) found.push({ file, dynamic: m[1] === "(" });
    }
  }
  return found;
}

test("readable.ts is imported from exactly one module, dynamically", () => {
  const edges = edgesToExtractor();
  const named = edges.map((e) => `${relative(SRC, e.file)}${e.dynamic ? " (dynamic)" : " (STATIC)"}`);
  expect(named).toEqual([`${relative(SRC, DOOR)} (dynamic)`]);
});

test("cacheUntilFailure runs the load once and shares the result", async () => {
  let calls = 0;
  const load = cacheUntilFailure(async () => {
    calls++;
    return { n: calls };
  });
  const [a, b] = await Promise.all([load(), load()]);
  expect(calls).toBe(1);
  expect(a).toBe(b);
  expect(await load()).toBe(a);
  expect(calls).toBe(1);
});

test("cacheUntilFailure does not cache a rejection", async () => {
  let calls = 0;
  const load = cacheUntilFailure(async () => {
    calls++;
    if (calls === 1) throw new Error("chunk did not arrive");
    return "loaded";
  });
  await expect(load()).rejects.toThrow("chunk did not arrive");
  expect(await load()).toBe("loaded");
  expect(calls).toBe(2);
});

test("the deferred module still extracts an article, and loads once", async () => {
  const extract = await loadExtractReadable();
  expect(await loadExtractReadable()).toBe(extract);

  const para = "The quick brown fox jumped over the lazy dog. ".repeat(40);
  const html =
    `<html><head><title>A Headline</title></head><body>` +
    `<nav>menu menu menu</nav>` +
    `<article><h1>A Headline</h1><p>${para}</p><p>${para}</p></article>` +
    `</body></html>`;

  const article = extract(html, "https://example.com/a");
  expect(article).not.toBeNull();
  expect(article!.title).toBe("A Headline");
  expect(article!.textContent.length).toBeGreaterThan(500);
  expect(article!.contentHtml).toContain("quick brown fox");
  // The page chrome is what the extractor exists to drop.
  expect(article!.textContent).not.toContain("menu menu menu");
});
