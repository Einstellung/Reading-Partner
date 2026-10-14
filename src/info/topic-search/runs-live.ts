// The live wiring of topic-search runs (docs/info/88 「两种 run」「排队」「停手」
// 「送达」): this device's files, browse window, keep-awake lock, box, runner and
// durable runtime. The shell calls registerTopicSearchRuns once at startup,
// handing in the result builder and how to put a halt on the collector's
// state file (info/program owns that file; it imports this directory, not the
// other way round).

import { appBox, randomBoxItemId } from "../../box/store";
import { t } from "../../i18n";
import { WEBVIEW_FETCH } from "../../legion/claim";
import { deviceRuntime } from "../../legion/durable/background";
import { registerProgramTask } from "../../legion/durable/program-task";
import { appRunner } from "../../legion/runner/runner";
import { registerWorker } from "../../legion/runner/worker";
import { statementStore } from "../../memory";
import { appData } from "../../platform/app/appdata";
import { currentDeviceId } from "../../platform/app/device";
import { keepAwake } from "../../platform/app/keep-awake";
import { hasWebviewFetch } from "../../platform/app/platform";
import { openBrowse } from "../../workshop/extract/webview-browse";
import { checkSiteSession } from "../../workshop/extract/webview-session";
import { allSignInSites, applySessionCheck } from "../sources/site-session";
import { loadSiteSessions, saveSiteSessions } from "../sources/source-store";
import { X_SIGN_IN_URL } from "../sources/x-search";
import type { XHalt } from "../x/search-page";
import { resolveRedirect } from "../x/live";
import { stopFollowing } from "./apply";
import { registerFirstRunDispatcher } from "./first-run";
import { recordHalt, haltNeedsReader, resumeHalt, xGate } from "./halt";
import type { XResume } from "./resume-tool";
import { lastNightAnchor, type NightConditions } from "./nightly";
import {
  TOPIC_SEARCH_BOX_KIND,
  TOPIC_SEARCH_HALT_BOX_KIND,
  TOPIC_SEARCH_KIND,
  topicSearchTask,
  type BuildTopicSearchResult,
  type TopicSearchRunDeps,
} from "./run";
import {
  createStateStore,
  loadRead,
  nightLimits,
  progressLog,
  runDirOf,
  saveRead,
  spendNight,
} from "./run-state";
import { createNightTick, firstRunDispatcher, topicSearchWorker } from "./run-worker";
import { changeTopicSearch, loadTopicSearches } from "./store";
import { localDay } from "./x-progress";
import { inXLane } from "./x-lane";

/** The browse window sits idle through a sitting's break (88: up to 30 minutes), so it may idle an hour. */
const BROWSE_IDLE_MS = 60 * 60_000;
const X_HOST = new URL(X_SIGN_IN_URL).hostname;

const state = createStateStore(appData);
const reporters = new Map<string, (text: string) => void>();
let builder: BuildTopicSearchResult | null = null;

/** Hand in (or take back) the function that turns what a run read into its result file. */
export function setTopicSearchResultBuilder(build: BuildTopicSearchResult | null): void {
  builder = build;
}

export interface TopicSearchRunPorts {
  build?: BuildTopicSearchResult;
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
  return status.signedIn ? "ok" : "signed-out";
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
      // Opened onto the sources page, at X's sign-in row.
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
    runDir: async (runId) => {
      const dir = runDirOf(runId);
      await appData.mkdirp(dir);
      return dir;
    },
    progress: (dir) => progressLog(appData, dir),
    saveRead: (dir, x) => saveRead(appData, dir, x),
    loadRead: (dir) => loadRead(appData, dir),
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
    halted,
    keepAwake: (reason) => keepAwake(reason),
    open: (viewport) => openBrowse({ idleTimeoutMs: BROWSE_IDLE_MS, viewport }),
    expandLink: (tco) => resolveRedirect(tco),
    deliver: async (item) => {
      await appBox().put({
        id: item.id,
        boxId: item.runId,
        source: "run",
        kind: TOPIC_SEARCH_BOX_KIND,
        runId: item.runId,
        cover: item.cover,
        body: item.resultFile,
        origin: { place: "door", date: item.date },
      });
    },
    newBoxItemId: randomBoxItemId,
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
  let lifted = false;
  const after = await state.update((s) => {
    const resumed = resumeHalt(s.halt);
    lifted = resumed.lifted;
    return lifted ? { ...s, halt: resumed.record } : s;
  });
  return { lifted, halt: after.halt };
}

/** Why X is not read on this device tonight, or null. */
export async function xReadingPaused(): Promise<string | null> {
  return xGate((await state.load()).halt, lastNightAnchor(Date.now()));
}
