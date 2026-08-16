// One-off repair for the dates written into observations before the distillers
// learned to read them off the evidence (src/observation/distill/distill.ts). Every pass
// used to tell the model "today is <the day this pass runs>", and the arrears
// sweep runs days after the conversation it distils, so the prose says a day the
// reader was not there. The frontmatter is fine — `created`/`updated` are write
// stamps and were always honest — and so is everything a later pass rewrites.
// What is left is the prose of entries no pass will touch again.
//
// The only trustworthy record of when the evidence happened is the entry's own
// `messages` anchors, `<threadId>:<ts>`: that ts is the message's. This turns
// them back into a date and, where it can prove the substitution is safe,
// swaps the pass's date for the reader's.
//
// It is a rewrite of natural language, so it does very little. An entry is left
// alone unless one pass wrote it, its anchors all fall on one day, the wrong
// date is exactly the day that pass ran, and every occurrence of that date
// stands as a whole token. Everything else is printed for a person to read.
//
//   bun scripts/observation-dates.ts                 # dry run, writes nothing
//   bun scripts/observation-dates.ts --write         # after backing the files up
//   bun scripts/observation-dates.ts --dir <appdata> --topic <topicId>
//
// Default data directory is the desktop app's AppData:
//   Linux   ~/.local/share/com.xinyuan.readingpartner
//   macOS   ~/Library/Application Support/com.xinyuan.readingpartner

import { mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { localDate, parseIndexLine, serializeIndexLine } from "../src/observation/record/files";
import { isObservationType } from "../src/observation/record/types";

// --- pure: what the anchors say ---------------------------------------------

// The calendar days an entry's anchors fall on, on the reader's own clock. Same
// rule as the distillers' evidenceDates: a stamp that is not a usable epoch
// (the rows written before messages carried one) is dropped rather than
// formatted into 1970, and an entry left with none says nothing.
export function anchorDates(messageIds: readonly string[]): { first: string; last: string } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const anchor of messageIds) {
    // The thread id is a UUID and holds no colon, but split from the right
    // anyway: the ts is the last field by construction, whatever precedes it.
    const cut = anchor.lastIndexOf(":");
    if (cut < 0) continue;
    const ts = Number(anchor.slice(cut + 1));
    if (!Number.isFinite(ts) || ts <= 0) continue;
    if (ts < lo) lo = ts;
    if (ts > hi) hi = ts;
  }
  return hi < 0 ? null : { first: localDate(lo), last: localDate(hi) };
}

// --- pure: what the prose says ----------------------------------------------

const ISO_DATE = /\d{4}-\d{2}-\d{2}/g;

export function dateLiterals(text: string): string[] {
  return [...new Set(text.match(ISO_DATE) ?? [])];
}

// A date is only replaceable where it stands as a whole token. The prose holds
// compound forms a substitution would turn into nonsense — "2026-07-19/20",
// "2026-08-12/13" — and one of those inside an entry disqualifies the entry
// rather than being skipped quietly, because the sentence around it is then
// about two days and this script cannot tell which one it got wrong.
function boundary(ch: string | undefined): boolean {
  return ch === undefined || !/[0-9A-Za-z/\\_-]/.test(ch);
}

export function occurrences(text: string, literal: string): { index: number; safe: boolean }[] {
  const out: { index: number; safe: boolean }[] = [];
  for (let i = text.indexOf(literal); i >= 0; i = text.indexOf(literal, i + 1)) {
    out.push({
      index: i,
      safe: boundary(text[i - 1]) && boundary(text[i + literal.length]),
    });
  }
  return out;
}

// The text with every occurrence of `from` replaced, or null when any one of
// them is not a whole token — never a partial rewrite.
export function replaceDateLiteral(
  text: string,
  from: string,
  to: string,
): { text: string; count: number } | null {
  const hits = occurrences(text, from);
  if (hits.some((h) => !h.safe)) return null;
  return { text: hits.length === 0 ? text : text.split(from).join(to), count: hits.length };
}

// --- pure: the decision -----------------------------------------------------

export interface EntryFacts {
  id: string;
  created: string;
  updated: string;
  // The prose regions, in the order they are printed. Passed separately because
  // only these are editable: the frontmatter's own dates are write stamps and
  // must survive the rewrite untouched.
  summary: string;
  body: string;
  messageIds: string[];
}

export type Plan =
  // Nothing to compare against: no anchor carries a usable timestamp.
  | { kind: "no-anchor"; mismatch: false; literals: string[] }
  // No pass date in the prose lies outside the anchors.
  | { kind: "agrees"; mismatch: false; dates: { first: string; last: string }; literals: string[] }
  // Wrong, and a person has to decide.
  | {
      kind: "manual";
      mismatch: boolean;
      dates: { first: string; last: string };
      reason: string;
      literals: string[];
    }
  // Wrong, and provably one substitution.
  | {
      kind: "fix";
      mismatch: true;
      dates: { first: string; last: string };
      from: string;
      to: string;
      literals: string[];
    };

export function planEntry(facts: EntryFacts): Plan {
  const prose = `${facts.summary}\n${facts.body}`;
  const literals = dateLiterals(prose);
  const dates = anchorDates(facts.messageIds);
  if (dates === null) return { kind: "no-anchor", mismatch: false, literals };

  // The store stamps `created`/`updated` from the same clock reading that told
  // the prompt what day it was, so a pass date appearing in the prose is the
  // fingerprint of the bug. A literal that is neither is something the
  // conversation itself said and is never touched.
  const passDates = [...new Set([facts.created, facts.updated])].filter(Boolean);
  const stale = passDates.filter(
    (d) => literals.includes(d) && (d < dates.first || d > dates.last),
  );
  if (stale.length === 0) return { kind: "agrees", mismatch: false, dates, literals };

  const manual = (reason: string): Plan => ({ kind: "manual", mismatch: true, dates, reason, literals });

  if (facts.created !== facts.updated) {
    return manual(
      `two passes wrote this entry (created ${facts.created}, updated ${facts.updated}) and their` +
        " anchors are pooled, so which prose date belongs to which pass's evidence is not decidable",
    );
  }
  if (dates.first !== dates.last) {
    return manual(
      `the anchors span ${dates.first} to ${dates.last}, so the day a given sentence means is not decidable`,
    );
  }
  if (stale.length > 1) return manual(`more than one stale pass date (${stale.join(", ")})`);

  const from = stale[0];
  const to = dates.first;
  for (const region of [facts.summary, facts.body]) {
    if (replaceDateLiteral(region, from, to) === null) {
      return manual(`${from} appears inside a longer token (a compound like "${from}/13")`);
    }
  }
  return { kind: "fix", mismatch: true, dates, from, to, literals };
}

// --- pure: rewriting one entry file -----------------------------------------

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

export interface EntryFile {
  head: string; // the frontmatter block, delimiters included
  body: string; // everything after it, verbatim
}

export function splitEntryFile(text: string): EntryFile | null {
  const m = FRONTMATTER.exec(text);
  return m === null ? null : { head: m[0], body: text.slice(m[0].length) };
}

export function frontmatter(head: string): Map<string, string> {
  const fields = new Map<string, string>();
  const inner = FRONTMATTER.exec(head);
  if (!inner) return fields;
  for (const raw of inner[1].split("\n")) {
    const cut = raw.indexOf(":");
    if (cut < 0) continue;
    fields.set(raw.slice(0, cut).trim(), raw.slice(cut + 1).trim());
  }
  return fields;
}

// The file with the substitution applied to the summary line and the body, and
// to nothing else — the id, the type and the two write stamps come out byte for
// byte as they went in. Null when any occurrence is not a whole token.
export function rewriteEntryFile(text: string, from: string, to: string): string | null {
  const split = splitEntryFile(text);
  if (split === null) return null;
  const headLines: string[] = [];
  for (const line of split.head.split("\n")) {
    if (!line.startsWith("summary:")) {
      headLines.push(line);
      continue;
    }
    const done = replaceDateLiteral(line, from, to);
    if (done === null) return null;
    headLines.push(done.text);
  }
  const body = replaceDateLiteral(split.body, from, to);
  if (body === null) return null;
  return headLines.join("\n") + body.text;
}

// The index is derived from the entries, so its line for a rewritten entry is
// re-serialized from the new summary rather than patched: patching the line
// would also hit the `updated` stamp printed in it, which is not prose and is
// not wrong. Null when the index has no line for this id.
export function rewriteIndexLine(indexText: string, id: string, summary: string): string | null {
  const lines = indexText.split("\n");
  let found = false;
  const out = lines.map((line) => {
    const parsed = parseIndexLine(line);
    if (!parsed || parsed.id !== id) return line;
    found = true;
    return serializeIndexLine({ ...parsed, summary });
  });
  return found ? out.join("\n") : null;
}

// --- the run ----------------------------------------------------------------

function defaultDataDir(): string {
  const app = "com.xinyuan.readingpartner";
  return platform() === "darwin"
    ? join(homedir(), "Library", "Application Support", app)
    : join(homedir(), ".local", "share", app);
}

function backupStamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

const ENTRY_FILE = /^m-[0-9a-f]{8}\.md$/;

interface Edit {
  topicDir: string;
  id: string;
  path: string; // absolute
  from: string;
  to: string;
  before: string;
  after: string;
  summaryAfter: string;
}

function changedLines(before: string, after: string): string[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const out: string[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) out.push(`      - ${a[i]}\n      + ${b[i]}`);
  }
  return out;
}

function main(): void {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | null => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const write = argv.includes("--write");
  const dataDir = flag("--dir") ?? defaultDataDir();
  const onlyTopic = flag("--topic");
  const backupDir =
    flag("--backup-dir") ??
    join(dirname(dataDir), `reading-partner-observation-dates-${backupStamp(new Date())}`);

  console.log(`data dir: ${dataDir}`);
  console.log(write ? "mode:     WRITE" : "mode:     dry run (pass --write to apply)");
  console.log("");

  let topicDirs: string[];
  try {
    topicDirs = readdirSync(dataDir).filter((n) => n.startsWith("memory-")).sort();
  } catch {
    console.error(`cannot read ${dataDir}`);
    process.exitCode = 1;
    return;
  }
  if (onlyTopic) topicDirs = topicDirs.filter((d) => d === `memory-${onlyTopic}`);

  const edits: Edit[] = [];
  const tally = { entries: 0, anchored: 0, mismatch: 0, fix: 0, manual: 0, noAnchor: 0 };

  for (const topicDir of topicDirs) {
    const names = readdirSync(join(dataDir, topicDir)).filter((n) => ENTRY_FILE.test(n)).sort();
    for (const name of names) {
      const path = join(dataDir, topicDir, name);
      const text = readFileSync(path, "utf8");
      const split = splitEntryFile(text);
      if (split === null) {
        console.log(`${topicDir}/${name}\n  SKIPPED   no frontmatter\n`);
        continue;
      }
      const fields = frontmatter(split.head);
      const type = fields.get("type") ?? "";
      if (!isObservationType(type)) {
        console.log(`${topicDir}/${name}\n  SKIPPED   unreadable type "${type}"\n`);
        continue;
      }
      tally.entries++;
      const messageIds = (fields.get("messages") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const facts: EntryFacts = {
        id: fields.get("id") ?? name.replace(/\.md$/, ""),
        created: fields.get("created") ?? "",
        updated: fields.get("updated") ?? "",
        summary: fields.get("summary") ?? "",
        body: split.body,
        messageIds,
      };
      const plan = planEntry(facts);
      if (plan.kind !== "no-anchor") tally.anchored++;
      if (plan.mismatch) tally.mismatch++;

      if (plan.kind === "agrees") continue;
      console.log(`${topicDir}/${name}`);
      const anchors = `${messageIds.length} message anchor(s)`;
      if (plan.kind === "no-anchor") {
        tally.noAnchor++;
        console.log(`  NO ANCHOR ${anchors}; dates in the prose: ${plan.literals.join(", ") || "none"}`);
        console.log("");
        continue;
      }
      const span =
        plan.dates.first === plan.dates.last
          ? plan.dates.first
          : `${plan.dates.first} to ${plan.dates.last}`;
      console.log(`  anchors   ${anchors}, ${span}`);
      console.log(`  stamps    created ${facts.created}, updated ${facts.updated}`);
      console.log(`  prose     ${plan.literals.join(", ") || "no dates"}`);
      if (plan.kind === "manual") {
        tally.manual++;
        console.log(`  MANUAL    ${plan.reason}`);
        console.log("");
        continue;
      }

      tally.fix++;
      const after = rewriteEntryFile(text, plan.from, plan.to);
      if (after === null) {
        // planEntry already proved this cannot happen; say so rather than write.
        console.log(`  MANUAL    rewrite refused after planning ${plan.from} -> ${plan.to}`);
        console.log("");
        tally.fix--;
        tally.manual++;
        continue;
      }
      const summaryAfter =
        replaceDateLiteral(facts.summary, plan.from, plan.to)?.text ?? facts.summary;
      console.log(`  FIX       ${plan.from} -> ${plan.to}`);
      for (const diff of changedLines(text, after)) console.log(diff);
      console.log("");
      edits.push({
        topicDir,
        id: facts.id,
        path,
        from: plan.from,
        to: plan.to,
        before: text,
        after,
        summaryAfter,
      });
    }
  }

  console.log("---");
  console.log(`${tally.entries} entries, ${tally.anchored} with a usable message anchor`);
  console.log(`${tally.mismatch} say a date their anchors contradict`);
  console.log(`${tally.fix} can be rewritten safely, ${tally.manual} need a person`);
  console.log(`${tally.noAnchor} have no anchor to check against`);

  if (edits.length === 0 || !write) {
    if (edits.length > 0) console.log("\nnothing written (dry run)");
    return;
  }

  // Every file about to change is copied first, path printed, before a byte
  // moves. The backup lives outside the app data directory so sync never sees it.
  const indexEdits = new Map<string, string>(); // absolute index path -> new text
  for (const edit of edits) {
    const indexPath = join(dataDir, edit.topicDir, "index.md");
    const current = indexEdits.get(indexPath) ?? readFileSync(indexPath, "utf8");
    const next = rewriteIndexLine(current, edit.id, edit.summaryAfter);
    if (next === null) {
      console.log(`note: ${edit.topicDir}/index.md has no line for ${edit.id}; left as it is`);
      continue;
    }
    indexEdits.set(indexPath, next);
  }

  console.log(`\nbackup: ${backupDir}`);
  for (const edit of edits) {
    const dest = join(backupDir, edit.topicDir, `${edit.id}.md`);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(edit.path, dest);
  }
  for (const indexPath of indexEdits.keys()) {
    const topicDir = dirname(indexPath).split(/[/\\]/).pop()!;
    const dest = join(backupDir, topicDir, "index.md");
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(indexPath, dest);
  }

  for (const edit of edits) writeFileSync(edit.path, edit.after);
  for (const [indexPath, text] of indexEdits) writeFileSync(indexPath, text);
  console.log(`wrote ${edits.length} entries and ${indexEdits.size} index files`);
}

if (import.meta.main) main();
