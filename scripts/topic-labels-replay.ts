#!/usr/bin/env bun
// Offline replay of a topic's labels against a result file (docs/info/91 标签):
// recall of the yes/pinned labels, their ranks and scores, the no-labelled
// items that made it in, borderline listed apart, and why the missing ones are
// missing when the run directories are at hand. No network, no model calls;
// nothing is written except by --import-seeds.
//
//   bun scripts/topic-labels-replay.ts <searchId> <result> [--dir DIR | --appdata]
//       [--labels FILE] [--version N] [--against RESULT] [--json]
//   bun scripts/topic-labels-replay.ts <searchId> --import-seeds FILE (--out DIR | --appdata)
//       [<result>] [--dir DIR]
//
// <result> is a path, or a file name (topic-search-<id>-<date>.json) under the
// data directory. The data directory is --dir, or --appdata for the app's own
// (~/.local/share/com.xinyuan.readingpartner), or else the result file's own
// directory; the real AppData is never read or written unless --appdata is
// given. From it come the labels (topic-search-labels-<id>.json, unless
// --labels), the run directories (topic-search-runs/<run>: arxiv-read.json,
// hf-read.json, x-read.json), and the topic (info-topic-searches.json, for the
// relevance floor).
//
// --import-seeds reads a hand-written list, one item a line:
//   yes 2505.06708 | exactly the kind I want
//   no https://arxiv.org/abs/2401.01234
//   borderline Some Paper Title
// and appends labels with source "import" to <out>/topic-search-labels-<id>.json.
// A title resolves only by an exact match among the result's items and the
// runs' reads; one that matches nothing is reported and not written.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { GuardedRead } from "../src/platform/app/atomic-fs";
import type { GuardedFileIo } from "../src/platform/app/guarded-file";
import {
  addTopicLabels,
  loadTopicLabels,
  parseTopicLabelsFile,
  topicLabelsFileName,
  type ParsedTopicLabels,
  type TopicLabel,
} from "../src/info/topic-search/labels";
import {
  candidatePool,
  formatComparison,
  formatReport,
  importedLabels,
  parseSeedLines,
  rankedItems,
  replayLabels,
  titleForm,
  type PoolEntry,
  type ReplayReport,
  type RunReads,
} from "../src/info/topic-search/label-replay";
import { parseResultFile, type TopicSearchResult } from "../src/info/topic-search/result-types";
import { ARXIV_READ_FILE, HF_READ_FILE, runDirOf, X_READ_FILE } from "../src/info/topic-search/run-state";
import { parseTopicSearchesFile } from "../src/info/topic-search/topic-searches";
import type { TopicSearch } from "../src/info/topic-search/types";
import type { ArxivRead } from "../src/info/topic-search/arxiv-read";
import type { XReadResult } from "../src/info/topic-search/x-reader";

const APP_DATA = join(homedir(), ".local/share/com.xinyuan.readingpartner");
const TOPIC_SEARCHES_FILE = "info-topic-searches.json";

// --- arguments ---------------------------------------------------------------

const argv = process.argv.slice(2);
const positional: string[] = [];
const flags = new Map<string, string | true>();
const VALUED = new Set(["--dir", "--labels", "--version", "--against", "--import-seeds", "--out"]);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (VALUED.has(a)) {
    const v = argv[++i];
    if (v === undefined) fail(`${a} needs a value`);
    flags.set(a, v);
  } else if (a === "--json" || a === "--appdata") flags.set(a, true);
  else if (a.startsWith("--")) fail(`unknown option ${a}`);
  else positional.push(a);
}
const str = (k: string) => (typeof flags.get(k) === "string" ? (flags.get(k) as string) : null);

function fail(message: string): never {
  console.error(message);
  console.error("usage: bun scripts/topic-labels-replay.ts <searchId> <result> [--dir DIR | --appdata] [--labels FILE] [--version N] [--against RESULT] [--json]");
  console.error("       bun scripts/topic-labels-replay.ts <searchId> --import-seeds FILE (--out DIR | --appdata) [<result>] [--dir DIR]");
  process.exit(2);
}

const [searchId, resultArg] = positional;
if (!searchId) fail("give the topic search id");
if (str("--dir") && flags.has("--appdata")) fail("--dir and --appdata are two data directories; give one");
const givenRoot = flags.has("--appdata") ? APP_DATA : str("--dir") ? resolve(str("--dir")!) : null;

// --- files --------------------------------------------------------------------

/** A result arg as a path: as given when it is a path, else under the data directory. */
function resultPath(arg: string): string {
  if (arg.includes("/") || isAbsolute(arg)) return resolve(arg);
  if (!givenRoot) fail(`${arg} is a file name: say where it is with --dir DIR or --appdata, or give a path`);
  return join(givenRoot, arg);
}

function readResult(path: string): TopicSearchResult {
  if (!existsSync(path)) fail(`no result file at ${path}`);
  const result = parseResultFile(readFileSync(path, "utf8"));
  if (!result) fail(`${path} is not a result file this build reads`);
  if (result.searchId !== searchId) console.error(`note: ${basename(path)} is of search ${result.searchId}, not ${searchId}`);
  return result;
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    console.error(`note: ${path} could not be parsed; left out`);
    return null;
  }
}

/** The run directories whose reads a result was made from: its own, each retry's or update's, each run it judged. */
function runReads(root: string, result: TopicSearchResult): RunReads[] {
  const dirs = new Set([result.runDir, ...(result.retries ?? []).map((r) => runDirOf(r.runId)), ...[...(result.judged ?? []), ...(result.retries ?? []).flatMap((r) => r.judged ?? [])].map(runDirOf)]);
  const out: RunReads[] = [];
  for (const dir of dirs) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    const arxiv = readJson<ArxivRead>(join(abs, ARXIV_READ_FILE));
    const hf = readJson<ArxivRead>(join(abs, HF_READ_FILE));
    const x = readJson<XReadResult>(join(abs, X_READ_FILE));
    if (!arxiv && !hf && !x) continue;
    out.push({ x: x && Array.isArray(x.posts) ? x : null, arxiv: arxiv?.found ?? [], huggingface: hf?.found ?? [] });
  }
  return out;
}

function readTopic(root: string): TopicSearch | null {
  const raw = readJson<unknown>(join(root, TOPIC_SEARCHES_FILE));
  return parseTopicSearchesFile(raw)?.searches.find((s) => s.id === searchId) ?? null;
}

/**
 * The labels file on a plain directory. Nothing is ever moved aside: a file
 * that does not parse stops the read, and a write over a repaired one is refused.
 */
function dirIo(dir: string): GuardedFileIo<ParsedTopicLabels> {
  return {
    async read(file, validate): Promise<GuardedRead<ParsedTopicLabels>> {
      const path = join(dir, file);
      if (!existsSync(path)) return { status: "missing" };
      try {
        const value = validate(JSON.parse(readFileSync(path, "utf8")));
        return value ? { status: "ok", value } : { status: "corrupt", savedAs: null };
      } catch {
        return { status: "corrupt", savedAs: null };
      }
    },
    async write(file, contents) {
      const path = join(dir, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(`${path}.tmp`, contents);
      renameSync(`${path}.tmp`, path);
    },
    async quarantine() {
      return null;
    },
    reportCorrupt({ file }) {
      console.error(`${file} has entries this build cannot read; not writing over it`);
    },
  };
}

async function loadLabels(root: string | null): Promise<TopicLabel[]> {
  const path = str("--labels");
  if (path) {
    const parsed = parseTopicLabelsFile(readJson<unknown>(resolve(path)));
    if (!parsed) fail(`${path} is not a labels file`);
    return parsed.labels;
  }
  if (!root) fail("no data directory to find the labels in: give --labels FILE, --dir DIR or --appdata");
  return loadTopicLabels(searchId, dirIo(root));
}

// --- replay ---------------------------------------------------------------------

async function replay(): Promise<void> {
  if (!resultArg) fail("give a result file");
  const path = resultPath(resultArg);
  const root = givenRoot ?? dirname(path);
  const labels = await loadLabels(root);
  if (labels.length === 0) fail(`no labels for ${searchId} (looked in ${str("--labels") ?? join(root, topicLabelsFileName(searchId))})`);
  const topic = readTopic(root);
  const version = str("--version") ? Number(str("--version")) : undefined;

  const reportOf = (p: string): ReplayReport => {
    const result = readResult(p);
    const reads = runReads(givenRoot ?? dirname(p), result);
    const pool = reads.length ? candidatePool(reads, topic) : null;
    return replayLabels(labels, rankedItems(result, version), pool, !!pool && topic !== null);
  };

  const a = reportOf(path);
  const againstArg = str("--against");
  const b = againstArg ? reportOf(resultPath(againstArg)) : null;
  if (flags.has("--json")) {
    console.log(JSON.stringify(b ? { a, b } : a, null, 2));
    return;
  }
  console.log(b ? formatComparison(a, b, [basename(path), basename(resultPath(againstArg!))]) : formatReport(a));
}

// --- import ---------------------------------------------------------------------

async function importSeeds(file: string): Promise<void> {
  const out = flags.has("--appdata") ? APP_DATA : str("--out") ? resolve(str("--out")!) : null;
  if (!out) fail("say where the labels go: --out DIR (or --appdata for the app's own data directory)");
  if (!existsSync(file)) fail(`no seed list at ${file}`);
  const { lines, bad } = parseSeedLines(readFileSync(file, "utf8"));
  for (const b of bad) console.error(`line ${b.line} skipped, not "<yes|no|borderline|pinned> <ref>": ${b.text}`);

  // Titles to resolve against: the result's items and what its runs read.
  const known = new Map<string, { key: string; title: string }>();
  const knownByKey = new Map<string, string>();
  let topic: TopicSearch | null = null;
  const root = givenRoot ?? (resultArg ? dirname(resultPath(resultArg)) : null);
  if (root) topic = readTopic(root);
  if (resultArg) {
    const result = readResult(resultPath(resultArg));
    const pool: Map<string, PoolEntry> = candidatePool(runReads(root!, result), null);
    for (const [key, entry] of pool) if (entry.title) knownByKey.set(key, entry.title);
    for (const item of rankedItems(result).items) knownByKey.set(item.key, item.title);
    for (const [key, title] of knownByKey) known.set(titleForm(title), { key, title });
  }
  const { labels, unresolved } = importedLabels(lines, known, knownByKey, {
    searchId,
    file: basename(file),
    criteria: topic?.revision ?? 0,
    now: Date.now(),
  });
  for (const u of unresolved) console.error(`line ${u.line} not written: "${u.ref}" is not an arXiv id, URL or key, and no title in the result matches it`);
  if (labels.length === 0) fail("nothing to write");
  const before = (await loadTopicLabels(searchId, dirIo(out))).length;
  const after = await addTopicLabels(searchId, labels, dirIo(out));
  const written = after.length - before;
  console.log(`${written} labels written to ${join(out, topicLabelsFileName(searchId))} (criteria ${topic?.revision ?? "0: topic not found"})`);
  for (const l of labels) console.log(`  ${l.label.padEnd(10)} ${l.item}  ${l.title}`);
  if (written < labels.length) process.exit(1);
}

const seeds = str("--import-seeds");
await (seeds ? importSeeds(resolve(seeds)) : replay());
