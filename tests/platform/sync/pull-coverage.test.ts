// Every file sync can write, against the routes that hear about it
// (src/platform/sync/pull-routes.ts).
//
// The failure this closes is silent: a file goes into sync range, another device
// changes it, the pull lands it on disk, and the shell or store holding that
// file in memory goes on serving the copy it loaded before. Nothing throws and
// nothing is logged; the value simply never appears until the app is restarted.
// It had already happened four times over, one shell registering a subset the
// other did not.
//
// So the range is read out of syncFs.ts rather than restated here — the root
// files from the exported set, the per-key patterns out of the source of
// inSyncRange — and each one must be claimed by a route or written down below
// with the reason it needs no route. A new synced file is neither until someone
// decides which. Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ASK_PULL_ROUTE } from "../../../src/info/briefing/handoff";
import { READER_PULL_ROUTE } from "../../../src/info/briefing/reader";
import { SOURCES_PULL_ROUTE } from "../../../src/info/sources/source-store";
import {
  BOOK_CACHE_PULL_ROUTE,
  dispatchPull,
  registerPullRoute,
  type PullMatcher,
} from "../../../src/platform/sync/pull-routes";
import { inSyncRange, ROOT_FILES } from "../../../src/platform/sync/syncFs";
import {
  KEPT_ARTICLES_PULL_ROUTE,
  SHELF_PULL_ROUTE,
} from "../../../src/reading/pull-routes";
import { SETTINGS_PULL_ROUTE } from "../../../src/ui/components/common/useShellBootstrap";

// Every route there is. A route declared in a module nobody lists here leaves
// its files looking unclaimed, so the list grows by being forced to.
const ROUTES: PullMatcher[] = [
  BOOK_CACHE_PULL_ROUTE,
  SHELF_PULL_ROUTE,
  KEPT_ARTICLES_PULL_ROUTE,
  SETTINGS_PULL_ROUTE,
  READER_PULL_ROUTE,
  SOURCES_PULL_ROUTE,
  ASK_PULL_ROUTE,
];

// Synced files that no route needs, and why. Each is read when the screen or the
// pass that wants it starts and nothing outlives that, so a pull's newer bytes
// are picked up the next time one starts.
const NO_IN_MEMORY_STATE: Record<string, string> = {
  "user-profile.md": "loadProfile reads the file each time it is wanted",
  "info-profile.md": "the profile's old name, read the same way",
  "info-feedback.jsonl": "append-only, and read in full when it is read at all",
  "info-pool-marks.json": "read at the start of a collection run, not held between them",
  "talk-": "a talk is read from disk when it is opened",
  "rehearsal-": "a talk's rehearsals are read with the talk, when that talk is opened",
  "memory-": "the observation store reads its entries per query",
  "prep-": "a document's prep material is read when the document it belongs to opens",
};

const SRC = fileURLToPath(new URL("../../../src/platform/sync/syncFs.ts", import.meta.url));
const source = readFileSync(SRC, "utf8");
// The body of inSyncRange alone: the walker below it repeats the directory
// prefixes as a pre-filter, and counting those would mask a prefix that is only
// ever accepted by one of the two.
const rangeStart = source.indexOf("export function inSyncRange");
const inRangeBody = source.slice(rangeStart, source.indexOf("\n}\n", rangeStart));

// A representative path for each per-key pattern, derived from the pattern
// itself rather than written out beside it, so a pattern that changes shape
// takes its sample with it.
function sampleForRegex(literal: string): string {
  return literal
    .replace(/^\/\^/, "")
    .replace(/\$\/$/, "")
    .replace(/\\\./g, ".")
    .replace(/\.\+/g, "sample");
}

// The nested ranges are directory prefixes, and a directory needs a file under
// it before inSyncRange will take it. What that file is called is the one thing
// the prefix cannot say, so it is said here.
const DIRECTORY_SAMPLES: Record<string, string[]> = {
  "memory-": ["memory-topic1/entries.jsonl", "memory-topic1/index.json"],
  "prep-": [
    "prep-book1/state.json",
    "prep-book1/attention-is-all-you-need.md",
    "prep-book1/chapters/state.json",
    "prep-book1/chapters/chapter-03.md",
  ],
};

function perKeySamples(): { pattern: string; paths: string[] }[] {
  const out: { pattern: string; paths: string[] }[] = [];
  for (const m of inRangeBody.matchAll(/\/\^[^/\n]+\$\//g)) {
    out.push({ pattern: m[0], paths: [sampleForRegex(m[0])] });
  }
  for (const m of inRangeBody.matchAll(/startsWith\("([^"]+)"\)/g)) {
    const prefix = m[1];
    const paths = DIRECTORY_SAMPLES[prefix];
    if (!paths) {
      throw new Error(
        `inSyncRange accepts everything under "${prefix}" and DIRECTORY_SAMPLES in ` +
          "tests/platform/sync/pull-coverage.test.ts has no example of one. Add one, then " +
          "decide whether it needs a pull route.",
      );
    }
    out.push({ pattern: `${prefix}*`, paths });
  }
  return out;
}

// Nothing below means anything if the samples are not really in range.
test("the samples this test is built from are all in sync range", () => {
  expect(ROOT_FILES.size).toBeGreaterThan(10);
  for (const file of ROOT_FILES) expect(inSyncRange(file)).toBe(true);

  const patterns = perKeySamples();
  // Six filename patterns and two directory prefixes, as of this writing;
  // the count is asserted so a pattern that stops being found by the scan is
  // noticed rather than quietly dropping its files from the check.
  expect(patterns.length).toBe(8);
  for (const { pattern, paths } of patterns) {
    for (const path of paths) {
      expect(`${pattern} -> ${path}: ${inSyncRange(path)}`).toBe(`${pattern} -> ${path}: true`);
    }
  }
});

function claim(path: string): string | null {
  const route = ROUTES.find((r) => r.matches(path));
  if (route) return route.id;
  for (const [key, reason] of Object.entries(NO_IN_MEMORY_STATE)) {
    if (path === key || path.startsWith(key)) return `allowlisted: ${reason}`;
  }
  return null;
}

test("every synced file is claimed by a pull route or written down as having no state", () => {
  const unclaimed: string[] = [];
  for (const file of ROOT_FILES) if (!claim(file)) unclaimed.push(file);
  for (const { paths } of perKeySamples()) {
    for (const path of paths) if (!claim(path)) unclaimed.push(path);
  }
  if (unclaimed.length > 0) {
    throw new Error(
      `\nThese files are synced and nothing hears when a pull writes them:\n` +
        unclaimed.map((f) => `  ${f}`).join("\n") +
        "\nEither register a pull route for whatever holds the file in memory, or add it to " +
        "NO_IN_MEMORY_STATE in this test with the reason it needs none.\n",
    );
  }
  expect(unclaimed).toEqual([]);
});

// The other direction: an allowlist entry that a route has since taken over, or
// that names a file sync no longer carries, is a note nobody will re-read.
test("no allowlist entry is stale", () => {
  const inRange = [
    ...ROOT_FILES,
    ...perKeySamples().flatMap((p) => p.paths),
  ];
  const stale: string[] = [];
  for (const key of Object.keys(NO_IN_MEMORY_STATE)) {
    const covered = inRange.filter((f) => f === key || f.startsWith(key));
    if (covered.length === 0) stale.push(`${key} (no synced file matches it any more)`);
    else if (covered.every((f) => ROUTES.some((r) => r.matches(f)))) {
      stale.push(`${key} (a route claims it now)`);
    }
  }
  expect(stale).toEqual([]);
});

// What the four hand-rolled subscribers each got right about their own files,
// checked against the routes that replaced them.
test("the routes claim the files their subscribers used to", () => {
  expect(claim("library.json")).toBe("shelf");
  expect(claim("topics.json")).toBe("shelf");
  expect(claim("saved-articles.json")).toBe("shelf");
  expect(KEPT_ARTICLES_PULL_ROUTE.matches("saved-articles.json")).toBe(true);
  expect(KEPT_ARTICLES_PULL_ROUTE.matches("library.json")).toBe(false);
  expect(claim("settings.json")).toBe("settings");
  expect(claim("threads-abc123.json")).toBe("book-caches");
  expect(claim("annotations-abc123.json")).toBe("book-caches");
  expect(claim("threads-talk-t1.json")).toBe("book-caches");
  expect(claim("info-briefing.json")).toBe("reader");
  expect(claim("info-bodies.json")).toBe("reader");
  expect(claim("info-collector-device1.json")).toBe("reader");
  expect(claim("info-sources.json")).toBe("sources");
  expect(claim("info-ask-device1.json")).toBe("ask");
});

test("a route hears only its own files", () => {
  expect(SHELF_PULL_ROUTE.matches("annotations-abc.json")).toBe(false);
  expect(BOOK_CACHE_PULL_ROUTE.matches("info-briefing.json")).toBe(false);
  expect(READER_PULL_ROUTE.matches("info-sources.json")).toBe(false);
  expect(SOURCES_PULL_ROUTE.matches("info-ask-device1.json")).toBe(false);
  expect(ASK_PULL_ROUTE.matches("info-collector-device1.json")).toBe(false);
  expect(SETTINGS_PULL_ROUTE.matches("device.json")).toBe(false);
});

// The dispatch itself. A route is handed the subset it matched, not the whole
// list: every one of the four subscribers this replaced began by filtering the
// list again, and two of them got the filter subtly different from syncFs.
test("a route is handed what it matched, and is left alone otherwise", () => {
  const heard: string[][] = [];
  const off = registerPullRoute({
    id: "test-only",
    matches: (path) => path.startsWith("mine-"),
    onPulled: (paths) => heard.push(paths),
  });

  dispatchPull(["mine-a.json", "theirs.json", "mine-b.json"]);
  expect(heard).toEqual([["mine-a.json", "mine-b.json"]]);

  // Nothing of this route's was written, so it is not called at all — a handler
  // never has to ask whether the list it was given is empty.
  dispatchPull(["theirs.json"]);
  expect(heard.length).toBe(1);

  off();
  dispatchPull(["mine-a.json"]);
  expect(heard.length).toBe(1);
});
