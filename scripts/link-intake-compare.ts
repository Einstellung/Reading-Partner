#!/usr/bin/env bun
// The docs/86 「第一期」 comparison: the eight X links of docs/84 「实测」, taken
// in by the rule path (reading/ingest/x-post.ts) once and by the link agent
// (takeLinkInFiled) N times per model, each run judged against the documents
// docs/86 says each link should bring in.
//
//   bun scripts/link-intake-compare.ts --model claude-haiku-5-5 [--model …] [--runs 3]
//       [--only handle,handle] [--no-rule] [--reasoning medium] [--cache DIR] [--out DIR]
//   bun scripts/link-intake-compare.ts --dry-run
//
// Live runs use the real network and the user's own Anthropic sign-in, read the
// way the app reads it (src/ai/auth): credentials.json in the app's data
// directory and nothing else of it. A token that has expired is refreshed and
// written back, as the app does, because the refresh token rotates on use. The
// token never leaves this process. Model calls go through the app's own turn
// (runHarnessTurn) on an in-memory session store, and the cost is pi's price
// table, not a bill.
//
// X permalink pages are read by WebKitGTK under xvfb-run (webkit-page.py):
// signed out, an ephemeral context, never the app's profile. Everything filed
// goes into a temporary directory, never the library. Every fetch, page read
// and t.co redirect is kept for the rest of the process (and in --cache DIR when
// given), so the runs after the first see the same pages and the comparison is
// about the decisions.
//
// --dry-run plays scripted turns on recorded fixtures (link-intake-compare/
// fixtures.ts) with no network and no model, to prove the plumbing.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Api, Model, Provider, ThinkingLevel, Usage } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { getValidAnthropicAuth } from "../src/ai/auth/anthropic-oauth";
import { providerCallSetup } from "../src/ai/call-setup";
import { registerSourceSiteAdapters } from "../src/info/sources/plugins/all";
import { scriptedTurn, type ScriptedRound } from "../src/info/links/scripted-turn";
import { tcoTarget } from "../src/info/x/outbound";
import { PERMALINK_SCRIPT } from "../src/info/x/permalink";
import type { PageAttempt, XReadDeps } from "../src/info/x/read-post";
import { xLinkReader } from "../src/info/x/reader";
import { runHarnessTurn } from "../src/legion/execute/turn";
import { createTurnSettler, workerLane } from "../src/legion/subagent/turn";
import type { SubagentTurnFn } from "../src/legion/subagent/types";
import { appData, type AppDataFs } from "../src/platform/app/appdata";
import type { ImportMeta, LibraryEntry } from "../src/platform/app/library";
import { createSessionFileSystem } from "../src/platform/app/session-fs";
import type { ArticleIngestDeps, IngestTarget } from "../src/reading/ingest/article";
import { takeLinkInFiled } from "../src/reading/ingest/link-intake";
import { ingestXPost } from "../src/reading/ingest/x-post";
import { siteAdapterFor, type FetchedBytes } from "../src/workshop/bindery";
import { loadExtractReadable } from "../src/workshop/extract/readable-lazy";
import { memoryAppData } from "../tests/support/memory-appdata";
import { DRY_RUN_PAGES, dryRunX, registerDryRunAdapters } from "./link-intake-compare/fixtures";

// bun has no DOMParser; the extractor and the sanitizer need one. jsdom, as the
// tests use (tests/support/preload.ts).
const require = createRequire(import.meta.url);
(globalThis as { DOMParser?: unknown }).DOMParser = new (require("jsdom") as typeof import("jsdom")).JSDOM("").window.DOMParser;

// ---------------------------------------------------------------------------
// The links and what each should bring in (docs/86 「第一期」).

interface Want {
  label: string;
  url: RegExp;
  minChars?: number;
  format?: "pdf";
}

interface LinkCase {
  handle: string;
  url: string;
  want: Want[];
}

const status = (id: string) => new RegExp(`x\\.com/[^/]+/status/${id}\\b`, "i");

const LINKS: LinkCase[] = [
  {
    handle: "fankaishuoai",
    url: "https://x.com/fankaishuoai/status/2106777694969176314",
    want: [{ label: "amontlabs/lcu README", url: /github\.com\/amontlabs\/lcu\b/i }],
  },
  {
    handle: "robotbird01",
    url: "https://x.com/robotbird01/status/2107026689935200274",
    // The whole book is some 640 KB of markdown; the README alone is under 2 000 characters.
    want: [{ label: "pi-durable-book, the whole book", url: /github\.com\/[^/]+\/[^/]*pi-durable[^/]*/i, minChars: 100_000 }],
  },
  {
    handle: "kirkdborne",
    url: "https://x.com/kirkdborne/status/2106806020043313226",
    want: [{ label: "Drive PDF Understanding Harness Engineering", url: /drive(\.usercontent)?\.google\.com/i, format: "pdf" }],
  },
  {
    handle: "0xMovez",
    url: "https://x.com/0xMovez/status/2106807332688580789",
    want: [
      { label: "quoted Article Full-course", url: /x\.com\/(?:[^/]+\/status\/2106761689123139973|i\/article\/)/i },
      { label: "Drive PDF from the author's reply", url: /drive(\.usercontent)?\.google\.com/i, format: "pdf" },
    ],
  },
  {
    handle: "jiangkoumo_",
    url: "https://x.com/jiangkoumo_/status/2107011055243440334",
    want: [{ label: "the post itself", url: status("2107011055243440334") }],
  },
  {
    handle: "suyuan1711",
    url: "https://x.com/suyuan1711/status/2102744129235193975",
    want: [{ label: "the Article itself", url: status("2102744129235193975") }],
  },
  {
    handle: "lonely__mh",
    url: "https://x.com/lonely__mh/status/2103501883449180167",
    want: [{ label: "the Article itself", url: status("2103501883449180167") }],
  },
  {
    handle: "manorgw",
    url: "https://x.com/manorgw/status/2107295528438337635",
    want: [{ label: "PraisonAI README", url: /github\.com\/[^/]+\/PraisonAI\b/i }],
  },
];

// ---------------------------------------------------------------------------
// Arguments.

interface Options {
  models: string[];
  runs: number;
  only: string[] | null;
  rule: boolean;
  dryRun: boolean;
  reasoning: ThinkingLevel | undefined;
  cache: string | null;
  out: string | null;
}

function parseArgs(argv: string[]): Options {
  const o: Options = { models: [], runs: 3, only: null, rule: true, dryRun: false, reasoning: "medium", cache: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--model") o.models.push(...next().split(",").map((m) => m.replace(/^anthropic\//, "")));
    else if (a === "--runs") o.runs = Number(next());
    else if (a === "--only") o.only = next().split(",").map((h) => h.toLowerCase());
    else if (a === "--no-rule") o.rule = false;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--reasoning") {
      const v = next();
      o.reasoning = v === "off" ? undefined : (v as ThinkingLevel);
    } else if (a === "--cache") o.cache = next();
    else if (a === "--out") o.out = next();
    else throw new Error(`unknown argument ${a}`);
  }
  if (o.dryRun && o.models.length === 0) o.models = ["scripted"];
  if (!o.dryRun && o.models.length === 0 && o.rule === false) throw new Error("nothing to run: give --model or drop --no-rule");
  if (!Number.isInteger(o.runs) || o.runs < 1) throw new Error("--runs takes a positive integer");
  return o;
}

// ---------------------------------------------------------------------------
// The network, kept for the rest of the process (and on disk with --cache).

const POLITE_UA = "Reading-Partner/0.2 (https://github.com/Einstellung/Reading-Partner; mailto:einstellungsu@gmail.com)";

class Kept {
  private mem = new Map<string, unknown>();
  constructor(private readonly dir: string | null) {}

  private file(kind: string, key: string): string | null {
    return this.dir ? join(this.dir, `${kind}-${createHash("sha1").update(key).digest("hex")}.json`) : null;
  }

  async get<T>(kind: string, key: string): Promise<T | undefined> {
    const k = `${kind} ${key}`;
    if (this.mem.has(k)) return this.mem.get(k) as T;
    const f = this.file(kind, key);
    if (f && existsSync(f)) {
      const v = JSON.parse(await readFile(f, "utf8")) as T;
      this.mem.set(k, v);
      return v;
    }
    return undefined;
  }

  async put(kind: string, key: string, value: unknown): Promise<void> {
    this.mem.set(`${kind} ${key}`, value);
    const f = this.file(kind, key);
    if (f) {
      await mkdir(dirname(f), { recursive: true });
      await writeFile(f, JSON.stringify(value));
    }
  }
}

interface StoredBytes {
  ok: boolean;
  status: number;
  contentType: string | null;
  contentDisposition: string | null;
  b64: string;
}

function liveFetch(kept: Kept) {
  return async (url: string): Promise<FetchedBytes> => {
    const hit = await kept.get<StoredBytes>("fetch", url);
    if (hit) return { ok: hit.ok, status: hit.status, contentType: hit.contentType, contentDisposition: hit.contentDisposition, bytes: new Uint8Array(Buffer.from(hit.b64, "base64")) };
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: { "User-Agent": POLITE_UA }, signal: AbortSignal.timeout(90_000) });
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await Bun.sleep(2000 * (attempt + 1));
        continue;
      }
      const bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : new Uint8Array();
      const got: FetchedBytes = { ok: res.ok, status: res.status, bytes, contentType: res.headers.get("content-type"), contentDisposition: res.headers.get("content-disposition") };
      // A definite answer is kept; a server having a bad moment is not.
      if (res.status < 500 && res.status !== 429) {
        await kept.put("fetch", url, { ok: got.ok, status: got.status, contentType: got.contentType ?? null, contentDisposition: got.contentDisposition ?? null, b64: Buffer.from(bytes).toString("base64") });
      }
      return got;
    }
  };
}

const HELPER = join(import.meta.dir, "link-intake-compare", "webkit-page.py");

function liveX(kept: Kept, fetchBytes: (url: string) => Promise<FetchedBytes>, scratch: string): XReadDeps {
  const scriptFile = join(scratch, "permalink.js");
  return {
    fetch: fetchBytes,
    readPage: async (url) => {
      const hit = await kept.get<PageAttempt>("page", url);
      if (hit) return hit;
      if (!existsSync(scriptFile)) await writeFile(scriptFile, PERMALINK_SCRIPT);
      const child = Bun.spawn(["xvfb-run", "-a", "python3", "-I", HELPER, url, scriptFile, "90"], { stdout: "pipe", stderr: "pipe" });
      const [out] = await Promise.all([new Response(child.stdout).text(), child.exited]);
      // The GL stack prints warnings on stdout too; the answer is the last JSON line.
      const line = out.split("\n").reverse().find((l) => l.startsWith("{"));
      if (!line) return { value: null, detail: `the page reader printed nothing (exit ${child.exitCode})` };
      const got = JSON.parse(line) as { value: unknown; detail: string | null; elapsedMs: number };
      const attempt: PageAttempt = { value: got.value, detail: got.detail };
      const posts = (got.value as { posts?: unknown[] } | null)?.posts;
      if (posts && posts.length > 0) await kept.put("page", url, attempt);
      return attempt;
    },
    resolveRedirect: async (url) => {
      const hit = await kept.get<{ to: string | null }>("redirect", url);
      if (hit) return hit.to;
      const res = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(30_000) });
      const body = res.status >= 300 && res.status < 400 ? "" : await res.text();
      const to = tcoTarget(res.status, res.headers.get("location"), body);
      if (to) await kept.put("redirect", url, { to });
      return to;
    },
    claimedBySite: (link) => siteAdapterFor({ kind: "url", url: link }) !== null,
  };
}

// ---------------------------------------------------------------------------
// Filing into a temporary directory instead of the library.

interface Shelved {
  path: string;
  url: string;
  title: string;
  format: string;
  bytes: number;
}

function tempShelf(dir: string, shelved: Shelved[]): Pick<ArticleIngestDeps, "importBook" | "attachToTopic" | "attachToBook"> {
  return {
    importBook: async (bytes: Uint8Array, originalPath: string, meta?: ImportMeta): Promise<LibraryEntry> => {
      const name = basename(meta?.filename ?? originalPath).replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 120) || "document";
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
      const path = join(dir, `${hash.slice(0, 8)}-${name}`);
      await mkdir(dir, { recursive: true });
      await writeFile(path, bytes);
      const format = /\.pdf$/i.test(name) ? "pdf" : "epub";
      shelved.push({ path, url: meta?.sourceUrl ?? "", title: name, format, bytes: bytes.length });
      return {
        hash,
        title: name.replace(/\.(epub|pdf)$/i, ""),
        originalFilename: name,
        addedAt: Date.now(),
        format,
        ...(meta?.kind ? { kind: meta.kind } : {}),
        ...(meta?.sourceUrl ? { sourceUrl: meta.sourceUrl } : {}),
      } as LibraryEntry;
    },
    attachToTopic: async () => {},
    attachToBook: async () => {},
  };
}

// ---------------------------------------------------------------------------
// The user's Anthropic sign-in, as the app reads it, and nothing else of AppData.

const APP_DATA = join(homedir(), ".local/share/com.xinyuan.readingpartner");
const CREDENTIALS = "credentials.json";

function credentialsOnlyAppData(): void {
  const real = (path: string): string => {
    if (path !== CREDENTIALS) throw new Error(`the comparison script reads only ${CREDENTIALS} of the app's data, not ${path}`);
    return join(APP_DATA, path);
  };
  const refuse = async (): Promise<never> => {
    throw new Error("the comparison script does not touch the app's data");
  };
  const port: AppDataFs = {
    exists: async (p) => existsSync(real(p)),
    readText: async (p) => readFile(real(p), "utf8"),
    readBytes: async (p) => new Uint8Array(await readFile(real(p))),
    stat: async (p) => {
      try {
        const s = await stat(real(p));
        return { mtimeMs: s.mtimeMs, size: s.size };
      } catch {
        return null;
      }
    },
    // A refreshed token goes back where the app keeps it, atomically.
    writeAtomic: async (p, contents) => {
      const file = real(p);
      const tmp = `${file}.compare-${process.pid}.tmp`;
      // The file keeps the permissions the app gave it.
      const mode = existsSync(file) ? (await stat(file)).mode & 0o777 : 0o600;
      await writeFile(tmp, contents, { mode });
      await rename(tmp, file);
    },
    writeBytes: refuse,
    appendText: refuse,
    readDir: refuse,
    mkdirp: refuse,
    remove: refuse,
    removeDir: refuse,
    rename: refuse,
    quarantine: refuse,
    readPicked: refuse,
  };
  Object.assign(appData, port);
}

interface RunUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  calls: number;
  /** What the model was handed and did: the task, each tool call with its answer, its last words. */
  task: string;
  transcript: { name: string; args: unknown; text: string }[];
  answer: string;
}

const noUsage = (): RunUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, calls: 0, task: "", transcript: [], answer: "" });

/** A sub-agent turn on the app's harness loop, Anthropic direct, usage counted per round. */
function liveTurn(model: Model<Api>, reasoning: ThinkingLevel | undefined, usage: RunUsage): SubagentTurnFn {
  const provider: Provider = anthropicProvider();
  return async (request) => {
    const apiKey = await getValidAnthropicAuth();
    if (!apiKey) throw new Error("Anthropic is not connected in the app");
    const settler = createTurnSettler(request.signal, request.onRound);
    try {
      void runHarnessTurn({
        stream: (m, ctx, opts) => {
          const s = provider.streamSimple(m, ctx, opts);
          s.result()
            .then((r) => add(usage, r.usage))
            .catch(() => {});
          return s;
        },
        model,
        apiKey,
        systemPrompt: request.systemPrompt,
        messages: [{ role: "user", content: request.task, timestamp: Date.now() }],
        tools: request.tools.map((tool) => ({
          ...tool,
          execute: async (args: Record<string, unknown>) => {
            const out = await tool.execute(args);
            usage.transcript.push({ name: tool.name, args, text: typeof out === "string" ? out : out.text });
            return out;
          },
        })),
        signal: request.signal,
        reasoning: reasoning && model.reasoning ? reasoning : undefined,
        ...providerCallSetup("anthropic", `compare-${Date.now()}`),
        maxRounds: request.maxRounds,
        purpose: request.purpose,
        lane: workerLane(request.name),
        fileSystem: createSessionFileSystem(memoryAppData()),
        stall: null,
        ...settler.callbacks,
      });
      usage.task = request.task;
      const outcome = await settler.outcome;
      if (outcome.kind === "answer") usage.answer = outcome.text;
      return outcome;
    } finally {
      settler.dispose();
    }
  };
}

function add(u: RunUsage, x: Usage | undefined): void {
  if (!x) return;
  u.input += x.input ?? 0;
  u.output += x.output ?? 0;
  u.cacheRead += x.cacheRead ?? 0;
  u.cacheWrite += x.cacheWrite ?? 0;
  u.cost += x.cost?.total ?? 0;
  u.calls++;
}

// ---------------------------------------------------------------------------
// The dry run's scripted turn: file whatever the expected set names, by number.

function dryTurn(link: LinkCase): SubagentTurnFn {
  return scriptedTurn((round, log): ScriptedRound => {
    if (round > 2) return { answer: "done" };
    if (round === 2) return { calls: [{ name: "finish", args: { note: "the expected set is filed" } }] };
    const numbers = new Map<string, number>();
    for (const m of log.task.matchAll(/^#(\d+) (?:\[[^\]]*\].*? — )?(\S+)/gm)) {
      const addr = `https://${m[2]}`;
      if (!numbers.has(addr)) numbers.set(addr, Number(m[1]));
    }
    const calls = link.want.flatMap((w) => {
      for (const [addr, n] of numbers) if (w.url.test(addr)) return [{ name: "file", args: { n } }];
      return [];
    });
    return { calls };
  }).turn;
}

// ---------------------------------------------------------------------------
// One run, recorded.

interface Doc {
  url: string;
  title: string;
  format: string;
  chars: number;
}

interface RunRecord {
  path: "rule" | "ai";
  model: string;
  run: number;
  handle: string;
  ms: number;
  documents: Doc[];
  rejected: { n: number; url: string; why: string }[];
  toolCalls: number;
  rounds: number;
  usage: RunUsage;
  stop: string;
  lead: string;
  notes: string[];
  trail: { n: number; url: string; action: string; result: string }[];
  error: string | null;
  verdict: { pass: boolean; missing: string[]; extra: string[] };
}

function judge(link: LinkCase, docs: Doc[]): RunRecord["verdict"] {
  const fits = (w: Want, d: Doc) =>
    w.url.test(d.url) && (w.minChars === undefined || d.chars >= w.minChars) && (w.format === undefined || d.format === w.format);
  const missing = link.want.filter((w) => docs.filter((d) => fits(w, d)).length !== 1).map((w) => w.label);
  const extra = docs.filter((d) => !link.want.some((w) => fits(w, d))).map((d) => `${short(d.url)} (${d.format}${d.chars ? `, ${d.chars} chars` : ""})`);
  return { pass: missing.length === 0 && extra.length === 0, missing, extra };
}

function short(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 70);
}

interface Env {
  fetch: (url: string) => Promise<FetchedBytes>;
  x: XReadDeps;
  extractReadable: ArticleIngestDeps["extractReadable"];
  out: string;
}

const TARGET: IngestTarget = { kind: "book", bookId: "link-intake-compare" };

async function runRule(link: LinkCase, env: Env): Promise<RunRecord> {
  const shelved: Shelved[] = [];
  const t0 = performance.now();
  const base = { path: "rule" as const, model: "rule", run: 1, handle: link.handle, rejected: [], toolCalls: 0, rounds: 0, usage: noUsage(), trail: [] };
  try {
    const batch = await ingestXPost(link.url, TARGET, {
      fetch: env.fetch,
      extractReadable: env.extractReadable,
      ...tempShelf(join(env.out, "files", link.handle, "rule"), shelved),
      x: env.x,
      saveRecord: async () => {},
    });
    const documents = batch.documents.map((d) => ({
      url: d.entry.sourceUrl ?? "",
      title: d.title,
      format: d.entry.format === "pdf" ? "pdf" : d.kind === "article" ? "article" : String(d.entry.format ?? d.kind),
      chars: d.chars,
    }));
    return { ...base, ms: performance.now() - t0, documents, stop: "rules", lead: batch.lead, notes: batch.notes, error: null, verdict: judge(link, documents) };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ...base, ms: performance.now() - t0, documents: [], stop: "error", lead: "", notes: [], error, verdict: { pass: false, missing: link.want.map((w) => w.label), extra: [] } };
  }
}

async function runAi(link: LinkCase, env: Env, model: string, run: number, turn: SubagentTurnFn, usage: RunUsage): Promise<RunRecord> {
  const shelved: Shelved[] = [];
  const t0 = performance.now();
  const base = { path: "ai" as const, model, run, handle: link.handle };
  try {
    const got = await takeLinkInFiled(link.url, TARGET, {
      fetch: env.fetch,
      extractReadable: env.extractReadable,
      ...tempShelf(join(env.out, "files", link.handle, `${model}-${run}`), shelved),
      readers: [xLinkReader(env.x)],
      turn,
      saveRecord: async () => {},
      signal: AbortSignal.timeout(10 * 60_000),
    });
    const intake = got.intake;
    const documents = intake.filed.map((f) => ({ url: f.url, title: f.title, format: f.format, chars: f.chars }));
    const stop =
      intake.stop.kind === "finished"
        ? `finish${intake.stop.note ? `: ${intake.stop.note}` : " (no note)"}`
        : `${intake.stop.kind}${"at" in intake.stop && intake.stop.at ? ` at #${intake.stop.at}` : ""}${"message" in intake.stop ? `: ${intake.stop.message}` : ""}`;
    return {
      ...base,
      ms: performance.now() - t0,
      documents,
      rejected: intake.candidates.filter((c) => c.rejected).map((c) => ({ n: c.n, url: c.url, why: c.rejected! })),
      toolCalls: intake.toolCalls,
      rounds: intake.rounds,
      usage,
      stop,
      lead: got.lead,
      notes: got.notes,
      trail: intake.trail,
      error: null,
      verdict: judge(link, documents),
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return {
      ...base,
      ms: performance.now() - t0,
      documents: [],
      rejected: [],
      toolCalls: 0,
      rounds: 0,
      usage,
      stop: "error",
      lead: "",
      notes: [],
      trail: [],
      error,
      verdict: { pass: false, missing: link.want.map((w) => w.label), extra: [] },
    };
  }
}

// ---------------------------------------------------------------------------
// The report.

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function report(records: RunRecord[], links: LinkCase[], models: string[], runs: number, rule: boolean): string {
  const lines: string[] = [];
  const cols = [...(rule ? [{ key: "rule", label: "rule" }] : []), ...models.flatMap((m) => Array.from({ length: runs }, (_, i) => ({ key: `${m}#${i + 1}`, label: `${m.replace(/^claude-/, "")} ${i + 1}` })))];
  const at = (r: RunRecord) => (r.path === "rule" ? "rule" : `${r.model}#${r.run}`);
  lines.push([pad("link", 14), ...cols.map((c) => pad(c.label, Math.max(6, c.label.length)))].join("  "));
  for (const link of links) {
    const row = cols.map((c) => {
      const r = records.find((x) => x.handle === link.handle && at(x) === c.key);
      return pad(r ? (r.verdict.pass ? "pass" : "FAIL") : "-", Math.max(6, c.label.length));
    });
    lines.push([pad(link.handle, 14), ...row].join("  "));
  }
  lines.push("");
  for (const r of records.filter((x) => !x.verdict.pass)) {
    const what = r.documents.length ? r.documents.map((d) => short(d.url)).join(", ") : "nothing";
    lines.push(`FAIL ${at(r)} ${r.handle}: filed ${what}`);
    if (r.verdict.missing.length) lines.push(`     missing: ${r.verdict.missing.join("; ")}`);
    if (r.verdict.extra.length) lines.push(`     extra: ${r.verdict.extra.join("; ")}`);
    for (const j of r.rejected) lines.push(`     rejected #${j.n} ${short(j.url)}: ${j.why}`);
    lines.push(`     stop: ${r.error ?? r.stop}`);
  }
  lines.push("");
  for (const m of models) {
    const rs = records.filter((r) => r.path === "ai" && r.model === m);
    if (rs.length === 0) continue;
    const n = rs.length;
    const sum = (f: (r: RunRecord) => number) => rs.reduce((s, r) => s + f(r), 0);
    lines.push(
      `${m}: ${rs.filter((r) => r.verdict.pass).length}/${n} pass; per link ${(sum((r) => r.ms) / n / 1000).toFixed(1)} s, ` +
        `$${(sum((r) => r.usage.cost) / n).toFixed(4)}, ${(sum((r) => r.usage.input + r.usage.cacheRead + r.usage.cacheWrite) / n).toFixed(0)} in / ` +
        `${(sum((r) => r.usage.output) / n).toFixed(0)} out tokens, ${(sum((r) => r.toolCalls) / n).toFixed(1)} tool calls, ${(sum((r) => r.rounds) / n).toFixed(1)} rounds`,
    );
  }
  const ruleRs = records.filter((r) => r.path === "rule");
  if (ruleRs.length) lines.push(`rule: ${ruleRs.filter((r) => r.verdict.pass).length}/${ruleRs.length} pass; per link ${(ruleRs.reduce((s, r) => s + r.ms, 0) / ruleRs.length / 1000).toFixed(1)} s`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const links = opts.only ? LINKS.filter((l) => opts.only!.includes(l.handle.toLowerCase())) : LINKS;
  if (links.length === 0) throw new Error("--only matched none of the links");
  const out = opts.out ?? (await mkdtemp(join(tmpdir(), "link-intake-compare-")));
  await mkdir(out, { recursive: true });
  const log = join(out, "runs.jsonl");
  console.log(`writing to ${out}`);

  let env: Env;
  if (opts.dryRun) {
    registerDryRunAdapters();
    const fetchBytes = async (url: string): Promise<FetchedBytes> => DRY_RUN_PAGES[url] ?? { ok: false, status: 404, bytes: new Uint8Array(), contentType: null };
    env = { fetch: fetchBytes, x: dryRunX(), extractReadable: await loadExtractReadable(), out };
  } else {
    registerSourceSiteAdapters();
    credentialsOnlyAppData();
    const kept = new Kept(opts.cache);
    const fetchBytes = liveFetch(kept);
    env = { fetch: fetchBytes, x: liveX(kept, fetchBytes, out), extractReadable: await loadExtractReadable(), out };
  }

  const models = new Map<string, Model<Api>>();
  if (!opts.dryRun) {
    const known = anthropicProvider().getModels();
    for (const id of opts.models) {
      const m = known.find((k) => k.id === id);
      if (!m) throw new Error(`pi-ai's Anthropic provider has no model ${id}`);
      models.set(id, m as Model<Api>);
    }
    if (opts.models.length > 0 && !(await getValidAnthropicAuth())) throw new Error("Anthropic is not connected in the app");
  }

  const records: RunRecord[] = [];
  const keep = async (r: RunRecord) => {
    records.push(r);
    await writeFile(log, `${JSON.stringify(r)}\n`, { flag: "a" });
    const docs = r.documents.map((d) => short(d.url)).join(", ") || "nothing";
    const cost = r.path === "ai" && !opts.dryRun ? ` $${r.usage.cost.toFixed(4)}` : "";
    console.log(`${r.verdict.pass ? "pass" : "FAIL"} ${r.path === "rule" ? "rule" : `${r.model}#${r.run}`} ${r.handle} ${(r.ms / 1000).toFixed(1)}s${cost} ${r.toolCalls} calls ${r.rounds} rounds: ${docs}${r.error ? ` — ${r.error}` : ""}`);
  };

  for (const link of links) {
    if (opts.rule) await keep(await runRule(link, env));
    for (const model of opts.models) {
      for (let run = 1; run <= opts.runs; run++) {
        const usage = noUsage();
        const turn = opts.dryRun ? dryTurn(link) : liveTurn(models.get(model)!, opts.reasoning, usage);
        await keep(await runAi(link, env, model, run, turn, usage));
      }
    }
  }

  const table = report(records, links, opts.models, opts.runs, opts.rule);
  await writeFile(join(out, "report.txt"), `${table}\n`);
  console.log(`\n${table}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
