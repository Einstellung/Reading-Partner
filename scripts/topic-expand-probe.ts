#!/usr/bin/env bun
// The hold-out experiment for a study's graph expansion (docs/info/92 怎么评):
// the yes/pinned labels split in two, each half in turn (with the seeds) used
// as the positives, the expansion asked to find the other half; reported per
// fold: how many held-out papers the graph found, how many of those the
// lexical reads missed, the share of no labels in the graph's own top 20, the
// months the recommendations fall in, and the DOI-only papers left out.
//
//   bun scripts/topic-expand-probe.ts <searchId> <result> --holdout
//       [--dir DIR | --appdata] [--labels FILE] [--since YYYY-MM-DD]
//       [--live [--anonymous] [--settings FILE]] [--out FILE] [--json]
//
// Without --live nothing goes on the network: the folds and the S2 request
// plan are printed with the cap. With --live the plan is sent to S2 through
// the host gate (one clock for the semanticscholar group, a cooled lane is
// skipped, never waited out), and no more than the cap is sent, retries
// included. The S2 key comes from S2_API_KEY, else from settings.json under
// --settings FILE or --appdata, read and never written; it is never printed.
// Without a key --anonymous is needed (the shared pool rate-limits at once,
// docs/info/92 接口事实). The expansion is the probe's own over S2
// (src/info/topic-search/expand-probe-s2.ts) until graph-live.ts lands.
//
// The files read are as for scripts/topic-labels-replay.ts; the only file
// written is --out, never one in the app's data directory.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  evaluateFold,
  formatFold,
  formatPlan,
  formatTotals,
  holdoutFolds,
  PROBE_LIMITS,
  requestPlan,
  type FoldReport,
} from "../src/info/topic-search/expand-probe";
import { budgetedFetch, s2Expander } from "../src/info/topic-search/expand-probe-s2";
import type { GraphRead } from "../src/info/topic-search/graph-read";
import { ARXIV_FIRST_LOOK_BACK_DAYS } from "../src/info/topic-search/windows";
import { gatedFetch, hostGate } from "../src/platform/http/host-gate";
import { APP_DATA, readLabels, readResultFile, readTopic, runReads } from "./topic-search-data";

const S2_HOST = "api.semanticscholar.org";

const argv = process.argv.slice(2);
const positional: string[] = [];
const flags = new Map<string, string | true>();
const VALUED = new Set(["--dir", "--labels", "--since", "--settings", "--out"]);
const SWITCHES = new Set(["--holdout", "--live", "--anonymous", "--appdata", "--json"]);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (VALUED.has(a)) {
    const v = argv[++i];
    if (v === undefined) fail(`${a} needs a value`);
    flags.set(a, v);
  } else if (SWITCHES.has(a)) flags.set(a, true);
  else if (a === "--round2" || a === "--model") fail(`${a} is not built yet: it needs the second round's gap finder (widen.ts)`);
  else if (a.startsWith("--")) fail(`unknown option ${a}`);
  else positional.push(a);
}
const str = (k: string) => (typeof flags.get(k) === "string" ? (flags.get(k) as string) : null);

function fail(message: string): never {
  console.error(message);
  console.error(
    "usage: bun scripts/topic-expand-probe.ts <searchId> <result> --holdout [--dir DIR | --appdata] [--labels FILE] [--since YYYY-MM-DD] [--live [--anonymous] [--settings FILE]] [--out FILE] [--json]",
  );
  process.exit(2);
}

const [searchId, resultArg] = positional;
if (!searchId || !resultArg) fail("give the topic search id and a result file");
if (!flags.has("--holdout")) fail("say which experiment: --holdout");
if (str("--dir") && flags.has("--appdata")) fail("--dir and --appdata are two data directories; give one");
const givenRoot = flags.has("--appdata") ? APP_DATA : str("--dir") ? resolve(str("--dir")!) : null;

const insideAppData = (path: string) => {
  const rel = relative(APP_DATA, path);
  return !rel.startsWith("..") && !isAbsolute(rel);
};
const outPath = str("--out") ? resolve(str("--out")!) : null;
if (outPath && insideAppData(outPath)) fail("--out must be outside the app's data directory");

const since = str("--since") ?? new Date(Date.now() - ARXIV_FIRST_LOOK_BACK_DAYS * 86_400_000).toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) fail("--since takes YYYY-MM-DD");

/** The S2 key and where it came from; the key itself is never printed. */
function s2Key(): { key: string | undefined; from: string } {
  const env = process.env.S2_API_KEY?.trim();
  if (env) return { key: env, from: "S2_API_KEY" };
  const file = str("--settings") ? resolve(str("--settings")!) : flags.has("--appdata") ? join(APP_DATA, "settings.json") : null;
  if (file && existsSync(file)) {
    try {
      const v = (JSON.parse(readFileSync(file, "utf8")) as { semanticScholarApiKey?: unknown }).semanticScholarApiKey;
      if (typeof v === "string" && v.trim()) return { key: v.trim(), from: file };
    } catch {
      console.error(`note: ${file} could not be parsed`);
    }
  }
  return { key: undefined, from: "none" };
}

async function main(): Promise<void> {
  const path = resultArg.includes("/") || isAbsolute(resultArg) ? resolve(resultArg) : givenRoot ? join(givenRoot, resultArg) : fail(`${resultArg} is a file name: say where it is with --dir DIR or --appdata, or give a path`);
  const root = givenRoot ?? dirname(path);
  const result = readResultFile(path, searchId);
  if (typeof result === "string") fail(result);
  const labels = await readLabels(searchId, str("--labels") ? resolve(str("--labels")!) : null, root);
  if (typeof labels === "string") fail(labels);
  const topic = readTopic(root, searchId);
  if (!topic) console.error(`note: topic ${searchId} not found under ${root}; no seeds`);
  const runs = runReads(root, result);
  if (runs.length === 0) console.error("note: no run reads at hand; every held-out paper will count as missed by the queries");

  const holdout = holdoutFolds(labels, topic?.seeds ?? []);
  if (holdout.folds.some((f) => f.heldOut.length === 0)) fail("the hold-out needs at least two arXiv yes/pinned labels besides the seeds");
  const plan = requestPlan(holdout.folds);
  console.log(formatPlan(holdout, plan));
  console.log(`window: papers from ${since}`);

  if (!flags.has("--live")) {
    console.log("\ndry run: no request sent; --live sends the plan");
    return;
  }

  const { key, from } = s2Key();
  if (!key && !flags.has("--anonymous")) fail("no S2 key (S2_API_KEY, --settings FILE or --appdata); --anonymous to use the shared pool");
  console.log(`S2 key: ${from === "none" ? "none, the shared anonymous pool" : `from ${from}`}`);

  const budget = budgetedFetch((url, init) => fetch(url, init), { [S2_HOST]: plan.cap });
  const expand = s2Expander({ fetchFn: gatedFetch(budget.fetchFn, 0, hostGate), apiKey: key });
  const folds: { read: GraphRead; report: FoldReport }[] = [];
  for (const fold of holdout.folds) {
    const read = await expand(fold.request);
    folds.push({ read, report: evaluateFold(fold, read, { runs, labels, since }) });
  }
  const spent = budget.spent()[S2_HOST] ?? 0;

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    const out = { searchId, result: path, at: new Date().toISOString(), since, limits: PROBE_LIMITS, plan, spent, folds: holdout.folds.map((f, i) => ({ fold: f, ...folds[i] })) };
    writeFileSync(outPath, JSON.stringify(out, null, 2));
  }
  if (flags.has("--json")) {
    console.log(JSON.stringify({ spent, folds: folds.map((f) => f.report) }, null, 2));
    return;
  }
  console.log("");
  for (const f of folds) console.log(`${formatFold(f.report)}\n`);
  console.log(formatTotals(folds.map((f) => f.report)));
  console.log(`S2 requests sent: ${spent} of the cap ${plan.cap}${outPath ? `; written to ${outPath}` : ""}`);
}

await main();
