// Latency table for one pulled silent-bench run (docs/platform/560).
//
//   bun scripts/ios-linux/voice-latency.ts <run-dir> [<run-dir> ...]
//
// <run-dir> holds rust.jsonl and native/native.jsonl as voice-run.sh pulls
// them. Several dirs are pooled into one p50/p90 table. Writes latency.json
// next to each run.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { formatReport, parseRows, turnsOf, type TurnLatency } from "../../src/soul/voice/harness/latency";

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error("usage: bun scripts/ios-linux/voice-latency.ts <run-dir> [...]");
  process.exit(2);
}

const all: TurnLatency[] = [];
for (const dir of dirs) {
  const files = [join(dir, "rust.jsonl"), join(dir, "native", "native.jsonl")];
  const rows = files.filter(existsSync).flatMap((f) => parseRows(readFileSync(f, "utf8")));
  if (rows.length === 0) {
    console.error(`${dir}: no rows`);
    process.exitCode = 1;
    continue;
  }
  const turns = turnsOf(rows);
  writeFileSync(join(dir, "latency.json"), JSON.stringify(turns, null, 2));
  console.log(`== ${dir}`);
  console.log(formatReport(turns));
  console.log("");
  all.push(...turns);
}
if (dirs.length > 1) {
  console.log("== pooled");
  console.log(formatReport(all));
}
