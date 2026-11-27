// Live wiring of dream: the two stores it reads, the state file it keeps, and
// the real model call.
//
// The entry points are dreamOwedNow and runDreamIfDue, and the only caller is
// the daily round (src/presence/daily.ts), which every device runs. Which device
// runs a night is whichever finds it owed first once its first sync pass has
// landed: each device writes down when it ran (runs.ts), and the others read
// that before deciding.

import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { currentDeviceId } from "../../platform/app/device";
import { logEvent } from "../../platform/app/events";
import { AI_EVENT_TOPIC } from "../../platform/app/structured-output";
import { callModel } from "../../ai/model-call";
import { observationFs } from "../live/live";
import {
  addEvidence,
  createStatement,
  listStatements,
  markSuperseded,
  supersede,
} from "../live/statements";
import { ObservationFileStore } from "../observations/store";
import type { Observation } from "../observations/types";
import { createDreamGate } from "./gate";
import { runDream, type DreamResult } from "./run";
import {
  DREAM_RUNS_DIR,
  dreamRunPath,
  latestDreamRun,
  parseDreamRun,
  type DreamRunRecord,
} from "./runs";
import {
  DREAM_STATE_FILE,
  EMPTY_DREAM_STATE,
  dreamNight,
  isDreamDue,
  type DreamState,
} from "./schedule";

// An unreadable or absent state file reads as "never ran". This is one
// device's own waterline, not content: losing it costs one extra pass over an
// input the last one already saw, and that pass writes the file back.
async function loadDreamState(): Promise<DreamState> {
  try {
    if (!(await appData.exists(DREAM_STATE_FILE))) return EMPTY_DREAM_STATE;
    const parsed = JSON.parse(await appData.readText(DREAM_STATE_FILE)) as Partial<DreamState>;
    return {
      lastRunDay: typeof parsed.lastRunDay === "string" ? parsed.lastRunDay : null,
      lastInputHash: typeof parsed.lastInputHash === "string" ? parsed.lastInputHash : null,
      lastOutcome:
        parsed.lastOutcome === "merged" ||
        parsed.lastOutcome === "no-change" ||
        parsed.lastOutcome === "failed"
          ? parsed.lastOutcome
          : null,
      lastRunAt: typeof parsed.lastRunAt === "number" ? parsed.lastRunAt : null,
    };
  } catch {
    return EMPTY_DREAM_STATE;
  }
}

async function saveDreamState(state: DreamState): Promise<void> {
  await writeTextAtomic(DREAM_STATE_FILE, JSON.stringify(state, null, 2));
}

// Every device's record of its last night. A file that will not read is one
// device's record missing, which at worst is one extra night.
async function readDreamRuns(): Promise<DreamRunRecord[]> {
  const entries = await appData.readDir(DREAM_RUNS_DIR).catch(() => []);
  const out: DreamRunRecord[] = [];
  for (const e of entries) {
    if (!e.isFile || !e.name.endsWith(".json")) continue;
    const text = await appData.readText(`${DREAM_RUNS_DIR}/${e.name}`).catch(() => null);
    const record = text === null ? null : parseDreamRun(text);
    if (record) out.push(record);
  }
  return out;
}

// Through the atomic writer: the write listeners are how a synced file leaves
// this device.
async function writeDreamRun(record: DreamRunRecord): Promise<void> {
  await appData.mkdirp(DREAM_RUNS_DIR);
  await writeTextAtomic(dreamRunPath(record.deviceId), JSON.stringify(record, null, 2));
}

async function latestRunAt(): Promise<number | null> {
  const [state, records] = await Promise.all([loadDreamState(), readDreamRuns()]);
  return latestDreamRun(state.lastRunAt, records);
}

/**
 * Whether a night is owed by every device's records as this one has them.
 * Never throws. The daily round asks it before it waits for the reader to stop.
 */
export async function dreamOwedNow(now = Date.now()): Promise<boolean> {
  try {
    return isDreamDue(await latestRunAt(), now);
  } catch {
    return false;
  }
}

// Every observation there is. Statements are not scoped to a topic, so neither
// is the input a night reads; a store that will not open is an empty night
// rather than a failed one, the same posture collectGuessEvidence takes to a bad
// read.
async function allObservations(): Promise<Observation[]> {
  return await new ObservationFileStore(observationFs).list().catch((): Observation[] => []);
}

// The one gate for this process, held across every entry point that calls in —
// start-up, foreground and the five-minute tick all reach the same object.
const gate = createDreamGate();

// One night, if one is due. Never throws: this rides the daily round's
// five-minute tick (src/presence/daily.ts), and a night that cannot run must not
// take the round's schedule down with it.
export async function runDreamIfDue(now = Date.now()): Promise<DreamResult | null> {
  // The record below is filed under this id; before device.json is read there
  // is no id to file it under.
  const deviceId = currentDeviceId();
  if (!deviceId) return null;
  const day = dreamNight(now);
  // Turned away rather than queued: three entry points fire within seconds of a
  // launch, and a queue would run the night once per caller (gate.ts).
  if (!gate.enter(day)) return null;
  let finished = false;
  try {
    const state = await loadDreamState();
    if (!isDreamDue(latestDreamRun(state.lastRunAt, await readDreamRuns()), now)) return null;
    // Written before the model is called, so a device whose first pass lands
    // while this night is still running already sees it taken.
    await writeDreamRun({ deviceId, lastRunAt: now });

    const [observations, statements] = await Promise.all([allObservations(), listStatements()]);
    const result = await runDream(
      { observations, statements, lastInputHash: state.lastInputHash },
      ({ systemPrompt, task }) =>
        callModel(
          "prep",
          "plan",
          systemPrompt,
          task,
          { signal: new AbortController().signal, onProgress: () => {} },
          // Planning like every other pipeline call, and the one whose spend has
          // to be readable on its own: it is the nightly pass, not a reader
          // waiting on an answer.
          { spend: { caller: "distill" } },
        ),
      { createStatement, addEvidence, supersede, markSuperseded },
    );
    // Marked here rather than after the write below: the day is used up by the
    // look, and a state file that would not save must not buy a second night.
    finished = true;

    // The day advances whatever happened, including a failure: the gate is one
    // look a day, and without it a provider that is down turns a five-minute
    // tick into a call every five minutes. The hash is the waterline and only
    // an outcome entitled to advance it carries one (run.ts).
    await saveDreamState({
      lastRunDay: day,
      lastInputHash: result.inputHash ?? state.lastInputHash,
      lastOutcome: result.outcome,
      lastRunAt: now,
    });
    logEvent(AI_EVENT_TOPIC, "dream-run", {
      outcome: result.outcome,
      candidates: result.candidates,
      written: result.written,
      dropped: result.dropped,
    });
    return result;
  } catch (e) {
    console.warn("the nightly dream pass failed", e);
    return null;
  } finally {
    gate.leave(day, finished);
  }
}
