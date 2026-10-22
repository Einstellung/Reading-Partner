#!/usr/bin/env bun
// Offline replay of a topic's labels against a result file (docs/info/91 标签):
// recall of the yes/pinned labels, their ranks and scores, the no-labelled
// items that made it in, borderline listed apart, and why the missing ones are
// missing when the run directories are at hand, and which route brought each
// labelled item into the pool (docs/info/92 怎么评: the first round's queries or
// graph expansion, the second round's, or none). No network, no model calls;
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
// hf-read.json, x-read.json, graph-read.json and the second round's -2 files),
// and the topic (info-topic-searches.json, for the relevance floor).
//
// --import-seeds reads a hand-written list, one item a line:
//   yes 2505.06708 | exactly the kind I want
//   no https://arxiv.org/abs/2401.01234
//   borderline Some Paper Title
// and appends labels with source "import" to <out>/topic-search-labels-<id>.json.
// A title resolves only by an exact match among the result's items and the
// runs' reads; one that matches nothing is reported and not written.

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { addTopicLabels, loadTopicLabels, topicLabelsFileName, type TopicLabel } from "../src/info/topic-search/labels";
import {
  candidatePool,
  formatComparison,
  formatReport,
  importedLabels,
  parseSeedLines,
  rankedItems,
  replayLabels,
  routeAttribution,
  titleForm,
  type PoolEntry,
  type ReplayReport,
} from "../src/info/topic-search/label-replay";
import type { TopicSearchResult } from "../src/info/topic-search/result-types";
import type { TopicSearch } from "../src/info/topic-search/types";
import { APP_DATA, dirIo, readLabels, readResultFile, readTopic as readTopicOf, runReads } from "./topic-search-data";

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
  const result = readResultFile(path, searchId);
  if (typeof result === "string") fail(result);
  return result;
}

function readTopic(root: string): TopicSearch | null {
  return readTopicOf(root, searchId);
}

async function loadLabels(root: string | null): Promise<TopicLabel[]> {
  const path = str("--labels");
  const labels = await readLabels(searchId, path ? resolve(path) : null, root);
  if (typeof labels === "string") fail(labels);
  return labels;
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
    const report = replayLabels(labels, rankedItems(result, version), pool, !!pool && topic !== null);
    return reads.length ? { ...report, routes: routeAttribution(labels, reads) } : report;
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
