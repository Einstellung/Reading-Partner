// The files the offline topic-search scripts read (topic-labels-replay.ts,
// topic-expand-probe.ts): a result, its run directories' reads, the topic, the
// labels. Nothing here writes except the labels file on a plain directory,
// and only when a caller asks to.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { GuardedRead } from "../src/platform/app/atomic-fs";
import type { GuardedFileIo } from "../src/platform/app/guarded-file";
import type { ArxivRead } from "../src/info/topic-search/arxiv-read";
import { GRAPH_READ_2_FILE, GRAPH_READ_FILE, parseGraphRead, type GraphRead } from "../src/info/topic-search/graph-read";
import type { RunReads } from "../src/info/topic-search/label-replay";
import { parseTopicLabelsFile, type ParsedTopicLabels, type TopicLabel } from "../src/info/topic-search/labels";
import { loadTopicLabels } from "../src/info/topic-search/labels";
import { parseResultFile, type TopicSearchResult } from "../src/info/topic-search/result-types";
import { ARXIV_READ_FILE, HF_READ_FILE, runDirOf, X_READ_FILE } from "../src/info/topic-search/run-state";
import { parseTopicSearchesFile } from "../src/info/topic-search/topic-searches";
import type { TopicSearch } from "../src/info/topic-search/types";
import type { XReadResult } from "../src/info/topic-search/x-reader";

export const APP_DATA = join(homedir(), ".local/share/com.xinyuan.readingpartner");
export const TOPIC_SEARCHES_FILE = "info-topic-searches.json";
// The second round's query reads (docs/info/92 第二轮查询).
export const ARXIV_READ_2_FILE = "arxiv-read-2.json";
export const HF_READ_2_FILE = "hf-read-2.json";

export function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    console.error(`note: ${path} could not be parsed; left out`);
    return null;
  }
}

/** The result file, or an error message. */
export function readResultFile(path: string, searchId: string): TopicSearchResult | string {
  if (!existsSync(path)) return `no result file at ${path}`;
  const result = parseResultFile(readFileSync(path, "utf8"));
  if (!result) return `${path} is not a result file this build reads`;
  if (result.searchId !== searchId) console.error(`note: ${basename(path)} is of search ${result.searchId}, not ${searchId}`);
  return result;
}

function readGraph(path: string): GraphRead | null {
  if (!existsSync(path)) return null;
  const read = parseGraphRead(readFileSync(path, "utf8"));
  if (!read) console.error(`note: ${path} is not a graph read this build reads; left out`);
  return read;
}

/** The run directories whose reads a result was made from: its own, each retry's or update's, each run it judged. */
export function runReads(root: string, result: TopicSearchResult): RunReads[] {
  const dirs = new Set([result.runDir, ...(result.retries ?? []).map((r) => runDirOf(r.runId)), ...[...(result.judged ?? []), ...(result.retries ?? []).flatMap((r) => r.judged ?? [])].map(runDirOf)]);
  const out: RunReads[] = [];
  for (const dir of dirs) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    const arxiv = readJson<ArxivRead>(join(abs, ARXIV_READ_FILE));
    const hf = readJson<ArxivRead>(join(abs, HF_READ_FILE));
    const x = readJson<XReadResult>(join(abs, X_READ_FILE));
    const graph = readGraph(join(abs, GRAPH_READ_FILE));
    const arxiv2 = readJson<ArxivRead>(join(abs, ARXIV_READ_2_FILE));
    const hf2 = readJson<ArxivRead>(join(abs, HF_READ_2_FILE));
    const graph2 = readGraph(join(abs, GRAPH_READ_2_FILE));
    if (!arxiv && !hf && !x && !graph && !arxiv2 && !hf2 && !graph2) continue;
    out.push({
      x: x && Array.isArray(x.posts) ? x : null,
      arxiv: arxiv?.found ?? [],
      huggingface: hf?.found ?? [],
      graph,
      round2: arxiv2 || hf2 || graph2 ? { arxiv: arxiv2?.found ?? [], huggingface: hf2?.found ?? [], graph: graph2 } : null,
    });
  }
  return out;
}

export function readTopic(root: string, searchId: string): TopicSearch | null {
  const raw = readJson<unknown>(join(root, TOPIC_SEARCHES_FILE));
  return parseTopicSearchesFile(raw)?.searches.find((s) => s.id === searchId) ?? null;
}

/**
 * The labels file on a plain directory. Nothing is ever moved aside: a file
 * that does not parse stops the read, and a write over a repaired one is refused.
 */
export function dirIo(dir: string): GuardedFileIo<ParsedTopicLabels> {
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

/** The labels from a labels file given by path, or from the data directory; an error message when neither reads. */
export async function readLabels(searchId: string, file: string | null, root: string | null): Promise<TopicLabel[] | string> {
  if (file) {
    const parsed = parseTopicLabelsFile(readJson<unknown>(file));
    return parsed ? parsed.labels : `${file} is not a labels file`;
  }
  if (!root) return "no data directory to find the labels in: give --labels FILE, --dir DIR or --appdata";
  return loadTopicLabels(searchId, dirIo(root));
}
