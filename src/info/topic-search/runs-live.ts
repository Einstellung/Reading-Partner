// The live wiring of topic-search runs (docs/info/88 「两种 run」「排队」「停手」
// 「送达」): this device's files, browse window, keep-awake lock, box, runner and
// durable runtime. The shell calls registerTopicSearchRuns once at startup,
// handing in how to put a halt on the collector's state file (info/program
// owns that file; it imports this directory, not the other way round). The
// result builder is build-live.ts's unless the caller hands in another.

import { appBox } from "../../box/store";
import { t } from "../../i18n";
import { WEBVIEW_FETCH } from "../../legion/claim";
import { deviceRuntime } from "../../legion/durable/background";
import { registerProgramTask } from "../../legion/durable/program-task";
import { appRunner } from "../../legion/runner/runner";
import { registerWorker } from "../../legion/runner/worker";
import { registerRunDescriber } from "../../legion/status/registry";
import { statementStore } from "../../memory";
import { appData } from "../../platform/app/appdata";
import { currentDeviceId } from "../../platform/app/device";
import { keepAwake } from "../../platform/app/keep-awake";
import { hasWebviewFetch } from "../../platform/app/platform";
import { openBrowse } from "../../workshop/extract/webview-browse";
import { checkSiteSession } from "../../workshop/extract/webview-session";
import { allSignInSites, applySessionCheck } from "../sources/site-session";
import { loadSiteSessions, loadSourceHealth, saveSiteSessions, saveSourceHealth } from "../sources/source-store";
import { X_SIGN_IN_URL } from "../sources/x-search";
import type { XHalt } from "../x/search-page";
import { resolveRedirect } from "../x/live";
import { stopFollowing } from "./apply";
import { SOURCE_HEALTH_FILE, type BuildTopicSearchResult } from "./build-result";
import { parseResultFile, pendingJudging, RESULT_FILE_PREFIX, type TopicSearchResult } from "./result-types";
import { topicSearchDescriber, type ShelfIssue, type TopicSearchStatusDeps } from "./run-status";
import { buildTopicSearchResult, searchArxivLive, searchHfLive } from "./build-live";
import { registerFirstRunDispatcher } from "./first-run";
import { clearSignedOut, recordHalt, haltNeedsReader, resumeHalt, xGate } from "./halt";
import type { XResume } from "./resume-tool";
import { planRetry, type RetryPlan } from "./retry";
import type { TopicSearch } from "./types";
import type { RetryToolDeps } from "./retry-tool";
import { lastNightAnchor, type NightConditions } from "./nightly";
import {
  TOPIC_SEARCH_HALT_BOX_KIND,
  TOPIC_SEARCH_KIND,
  topicSearchTask,
  type TopicSearchRunDeps,
} from "./run";
import {
  createStateStore,
  loadArxivRead,
  loadFirstPart,
  loadHfRead,
  loadRead,
  nightLimits,
  permalinkBudget,
  progressLog,
  runDirOf,
  saveArxivRead,
  saveFirstPart,
  saveHfRead,
  saveRead,
  spendNight,
} from "./run-state";
import { askRetryRun, createNightTick, firstRunDispatcher, topicSearchWorker } from "./run-worker";
import { foldTopicSearchHealth, parseSourceHealthFile } from "./source-health";
import { changeTopicSearch, loadTopicSearches } from "./store";
import { localDay } from "./x-progress";
import { inXLane } from "./x-lane";

/** The browse window sits idle through a sitting's break (88: up to 30 minutes), so it may idle an hour. */
const BROWSE_IDLE_MS = 60 * 60_000;
const X_HOST = new URL(X_SIGN_IN_URL).hostname;

const state = createStateStore(appData);
const reporters = new Map<string, (text: string) => void>();
let builder: BuildTopicSearchResult | null = buildTopicSearchResult;

/** Hand in (or take back) the function that turns what a run read into its result file. */
export function setTopicSearchResultBuilder(build: BuildTopicSearchResult | null): void {
  builder = build;
}

export interface TopicSearchRunPorts {
  build?: BuildTopicSearchResult;
  /** A run closed: the nightly brief (info/issue/live.ts issueRunClosed) takes it from here. */
  closed?: TopicSearchRunDeps["closed"];
  /** Put the halt line on this machine's collector state file (docs/info/36 `halt`). */
  noteHalt(text: string): Promise<void>;
}

const HALT_COVER = {
  "signed-out": "info.topicSearch.haltSignedOut",
  challenge: "info.topicSearch.haltChallenge",
  "rate-limited": "info.topicSearch.haltRateLimited",
  structure: "info.topicSearch.haltStructure",
} as const;

async function xSessionState(): Promise<"ok" | "signed-out" | "unknown"> {
  const site = allSignInSites([], true).find((s) => s.host === X_HOST);
  if (!site) return "unknown";
  const status = await checkSiteSession(site.checkUrl);
  await saveSiteSessions(applySessionCheck(await loadSiteSessions(), site.host, status, Date.now()));
  if (status.status !== "ok" && status.status !== "empty") return "unknown";
  // Signed in again: a signed-out record from before is over (halt.ts clearSignedOut).
  if (status.signedIn) await state.update((s) => (s.halt?.kind === "signed-out" ? { ...s, halt: null } : s));
  return status.signedIn ? "ok" : "signed-out";
}

/** The halt record with a signed-out one dropped once the session sidecar says signed in since. */
async function liftSignedOut(): Promise<void> {
  const session = (await loadSiteSessions())[X_HOST];
  await state.update((s) => {
    const halt = clearSignedOut(s.halt, session);
    return halt === s.halt ? s : { ...s, halt };
  });
}

function liveDeps(ports: TopicSearchRunPorts): TopicSearchRunDeps {
  const halted = async (halt: XHalt, about: { searchId: string; runId: string; night: string }) => {
    const now = Date.now();
    await state.update((s) => ({ ...s, halt: recordHalt(s.halt, halt, now, about.night) }));
    if (halt.kind === "signed-out") {
      await saveSiteSessions(applySessionCheck(await loadSiteSessions(), X_HOST, { status: "ok", signedIn: false }, now));
    }
    await ports.noteHalt(`X topic search stopped (${halt.kind}): ${halt.detail}`).catch(() => {});
    await appBox().put({
      boxId: about.runId,
      source: "run",
      kind: TOPIC_SEARCH_HALT_BOX_KIND,
      runId: about.runId,
      cover: t(HALT_COVER[halt.kind]),
      // Sign-in lives in Settings > Accounts.
      body: `sources:${X_HOST}`,
      origin: { place: "door", date: localDay(now) },
      needsDecision: haltNeedsReader(halt.kind),
    });
  };
  return {
    loadSearch: async (id) => (await loadTopicSearches()).find((s) => s.id === id) ?? null,
    ran: async (search, at) => {
      await changeTopicSearch(search.id, (s) => ({ ...s, lastRunAt: Math.max(s.lastRunAt ?? 0, at), revision: s.revision + 1 }));
    },
    stopOnce: async (search) => {
      await stopFollowing(search.id, {
        change: (id, change) => changeTopicSearch(id, change),
        setLapsed: (id, lapsed) => statementStore.setLapsed(id, lapsed),
      });
    },
    builder: () => ports.build ?? builder,
    xPages: (about) => permalinkBudget(state, about, () => Date.now()),
    foldSourceHealth: async (dir, search) => {
      const path = `${dir}/${SOURCE_HEALTH_FILE}`;
      if (!(await appData.exists(path))) return;
      const file = parseSourceHealthFile(await appData.readText(path));
      if (file) await saveSourceHealth(foldTopicSearchHealth(await loadSourceHealth(), file, search));
    },
    runDir: async (runId) => {
      const dir = runDirOf(runId);
      await appData.mkdirp(dir);
      return dir;
    },
    progress: (dir) => progressLog(appData, dir),
    saveRead: (dir, x) => saveRead(appData, dir, x),
    loadRead: (dir) => loadRead(appData, dir),
    searchArxiv: searchArxivLive,
    saveArxiv: (dir, read) => saveArxivRead(appData, dir, read),
    loadArxiv: (dir) => loadArxivRead(appData, dir),
    searchHf: searchHfLive,
    saveHf: (dir, read) => saveHfRead(appData, dir, read),
    loadHf: (dir) => loadHfRead(appData, dir),
    saveFirstPart: (dir, part) => saveFirstPart(appData, dir, part),
    loadFirstPart: (dir) => loadFirstPart(appData, dir),
    memory: state.reader,
    nightLimits: async (night) => nightLimits((await state.load()).night, night),
    spendNight: async (night, x) => {
      await state.update((s) => ({ ...s, night: spendNight(s.night, night, x) }));
    },
    gate: async (night) => xGate((await state.load()).halt, night),
    readClean: async () => {
      await state.update((s) => (s.halt ? { ...s, halt: null } : s));
    },
    checkSession: xSessionState,
    retryPlan: retryPlanOf,
    halted,
    keepAwake: (reason) => keepAwake(reason),
    open: (viewport, opts) => openBrowse({ idleTimeoutMs: BROWSE_IDLE_MS, viewport, initScript: opts?.initScript }),
    expandLink: (tco) => resolveRedirect(tco),
    closed: async (run) => {
      await ports.closed?.(run);
    },
    lane: inXLane,
    report: (runId, text) => reporters.get(runId)?.(text),
    now: () => Date.now(),
    random: () => Math.random(),
    sleep: (ms, signal) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(done, ms);
        function done() {
          signal.removeEventListener("abort", abort);
          resolve();
        }
        function abort() {
          clearTimeout(timer);
          reject(new Error("stopped"));
        }
        signal.addEventListener("abort", abort, { once: true });
      }),
  };
}

/** A search's result files on this device. */
async function loadResults(searchId: string): Promise<TopicSearchResult[]> {
  const names = (await appData.readDir("")).filter((e) => e.isFile && e.name.startsWith(`${RESULT_FILE_PREFIX}${searchId}-`));
  const out: TopicSearchResult[] = [];
  for (const e of names) {
    const parsed = parseResultFile(await appData.readText(e.name));
    if (parsed?.searchId === searchId) out.push(parsed);
  }
  return out;
}

/** What a retry reads again, and the runs whose reads wait to be judged (result files). */
async function retryPlanOf(search: TopicSearch): Promise<RetryPlan> {
  const waiting = pendingJudging(await loadResults(search.id)).map((u) => u.runId);
  return planRetry(search, await loadSourceHealth(), waiting);
}

/** The shelf file info/issue writes (info/issue/types.ts INFO_SHELF_FILE); read here without importing that domain. */
const SHELF_FILE = "info-shelf.json";

async function readJson(path: string): Promise<unknown> {
  if (!(await appData.exists(path))) return null;
  try {
    return JSON.parse(await appData.readText(path));
  } catch {
    return null;
  }
}

/** What background_status reads about a topic-search run on this device (run-status.ts). */
const statusDeps: TopicSearchStatusDeps = {
  searches: () => loadTopicSearches(),
  steps: async (runId) => {
    const steps = await progressLog(appData, runDirOf(runId)).load();
    return steps.length ? steps : null;
  },
  arxivRead: (runId) => loadArxivRead(appData, runDirOf(runId)),
  hfRead: (runId) => loadHfRead(appData, runDirOf(runId)),
  runHealth: async (runId) => {
    const path = `${runDirOf(runId)}/${SOURCE_HEALTH_FILE}`;
    return (await appData.exists(path)) ? parseSourceHealthFile(await appData.readText(path)) : null;
  },
  results: (searchId) => loadResults(searchId),
  issues: async () => {
    const shelf = (await readJson(SHELF_FILE)) as { issues?: ShelfIssue[] } | null;
    return Array.isArray(shelf?.issues) ? shelf.issues : [];
  },
  localX: async () => {
    await liftSignedOut();
    const session = (await loadSiteSessions())[X_HOST];
    return { halt: (await state.load()).halt, signedIn: !session || session.unknown ? null : session.signedIn };
  },
};

let nightTick: (() => Promise<string[]>) | null = null;

/** The worker, the `rp.topicsearch` task and the first-run dispatch. Once, at startup, on every device. */
export function registerTopicSearchRuns(ports: TopicSearchRunPorts): void {
  if (ports.build) builder = ports.build;
  const task = topicSearchTask(liveDeps(ports));
  registerProgramTask(task);
  registerWorker({
    kind: TOPIC_SEARCH_KIND,
    tier: "synced",
    requires: [WEBVIEW_FETCH],
    run: topicSearchWorker({
      runtime: (signal) => deviceRuntime(signal),
      task,
      reporters,
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    }),
  });
  registerRunDescriber(topicSearchDescriber(statusDeps));
  const delegate = appRunner().delegate;
  registerFirstRunDispatcher(firstRunDispatcher((input) => delegate(input)));
  nightTick = createNightTick({
    now: () => Date.now(),
    deviceId: currentDeviceId,
    delegate: (input) => delegate(input),
    conditions: async (night): Promise<NightConditions> => {
      const [searches, sessions, local] = await Promise.all([loadTopicSearches(), loadSiteSessions(), state.load()]);
      return {
        collecting: await collectingProbe(),
        webview: hasWebviewFetch(),
        sessionValid: sessions[X_HOST]?.signedIn === true,
        gate: xGate(local.halt, night),
        searches,
      };
    },
  });
}

let collectingProbe: () => Promise<boolean> = async () => false;

/**
 * The night's check, on the collector's five-minute tick (info/program/live.ts).
 * `collecting` is that file's amICollecting. Never throws.
 */
export async function checkTopicSearchNight(collecting: () => Promise<boolean>): Promise<void> {
  collectingProbe = collecting;
  try {
    await nightTick?.();
  } catch (e) {
    console.warn("the topic search night check failed", e);
  }
}

/** The reader said to read X again after a second challenge or limit (resume-tool.ts). */
export async function resumeXReading(): Promise<XResume> {
  await liftSignedOut();
  let lifted = false;
  const after = await state.update((s) => {
    const resumed = resumeHalt(s.halt);
    lifted = resumed.lifted;
    return lifted ? { ...s, halt: resumed.record } : s;
  });
  return { lifted, halt: after.halt };
}

/** The retry tool's live side (retry-tool.ts): the plan and the session on this device, and the ask. */
export const retryDeps: Omit<RetryToolDeps, "searches" | "known"> = {
  plan: retryPlanOf,
  xSignedIn: async () => {
    await liftSignedOut();
    const session = (await loadSiteSessions())[X_HOST];
    return !session || session.unknown ? null : session.signedIn;
  },
  ask: (searchId) => {
    const runner = appRunner();
    return askRetryRun(searchId, { runs: () => runner.list({ kind: TOPIC_SEARCH_KIND }), delegate: (input) => runner.delegate(input) });
  },
};

/** Why X is not read on this device tonight, or null. */
export async function xReadingPaused(): Promise<string | null> {
  return xGate((await state.load()).halt, lastNightAnchor(Date.now()));
}
