// Live wiring of dream: the two stores it reads, the state file it keeps, and
// the real model call.
//
// The only entry point is runDreamIfDue, and the only caller is the collector's
// daily tick (info/briefing/live.ts). Dream runs on one machine — the elected
// collector (docs/36) — because two machines would each pay for the night and
// write two readings of the same observations.

import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { logEvent } from "../../platform/app/events";
import { AI_EVENT_TOPIC } from "../../platform/app/structured-output";
import { listTopics } from "../../platform/app/topics";
import { callModel } from "../../ai/model-call";
import { observationFs } from "../live/live";
import {
  addEvidence,
  createStatement,
  listStatements,
  markSuperseded,
  supersede,
} from "../live/statements";
import { localDate } from "../observations/files";
import { ObservationFileStore } from "../observations/store";
import type { Observation } from "../observations/types";
import { runDream, type DreamResult } from "./run";
import {
  DREAM_STATE_FILE,
  EMPTY_DREAM_STATE,
  isDreamDue,
  type DreamState,
} from "./schedule";

// An unreadable or absent state file reads as "never ran". This is one
// machine's own waterline, not content: losing it costs one extra pass over an
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

// Every observation there is. Statements are not scoped to a topic, so neither
// is the input a night reads; a topic whose files will not open is skipped
// rather than taking the night down, the way collectGuessEvidence does.
async function allObservations(): Promise<Observation[]> {
  const all: Observation[] = [];
  for (const topic of await listTopics()) {
    const store = new ObservationFileStore(topic.id, observationFs);
    all.push(...(await store.list().catch((): Observation[] => [])));
  }
  return all;
}

// One night, if one is due. Never throws: this rides the collector's five-minute
// tick, and a night that cannot run must not take the morning briefing's
// schedule down with it.
export async function runDreamIfDue(now = Date.now()): Promise<DreamResult | null> {
  try {
    const state = await loadDreamState();
    if (!isDreamDue(state, now)) return null;

    const [observations, statements] = await Promise.all([allObservations(), listStatements()]);
    const result = await runDream(
      { observations, statements, lastInputHash: state.lastInputHash },
      ({ systemPrompt, task }) =>
        callModel("prep", "plan", systemPrompt, task, {
          signal: new AbortController().signal,
          onProgress: () => {},
        }),
      { createStatement, addEvidence, supersede, markSuperseded },
    );

    // The day advances whatever happened, including a failure: the gate is one
    // look a day, and without it a provider that is down turns a five-minute
    // tick into a call every five minutes. The hash is the waterline and only
    // an outcome entitled to advance it carries one (run.ts).
    await saveDreamState({
      lastRunDay: localDate(now),
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
  }
}
