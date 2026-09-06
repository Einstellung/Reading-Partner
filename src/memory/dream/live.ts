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
import { callModel } from "../../ai/model-call";
import { observationFs } from "../live/live";
import { observationLayoutFs } from "../live/fs";
import { legacyObservationLayout } from "../observations/legacy";
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
import { createDreamGate } from "./gate";
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
// is the input a night reads; a store that will not open is an empty night
// rather than a failed one, the same posture collectGuessEvidence takes to a bad
// read.
async function allObservations(): Promise<Observation[]> {
  return await new ObservationFileStore(observationFs).list().catch((): Observation[] => []);
}

// The one gate for this process, held across every entry point that calls in —
// start-up, foreground and the five-minute tick all reach the same object.
const gate = createDreamGate();

// A night that stood down before reading anything.
function standDown(): DreamResult {
  return { outcome: "waiting-migration", candidates: 0, written: 0, dropped: 0, inputHash: null };
}

// One night, if one is due. Never throws: this rides the collector's five-minute
// tick, and a night that cannot run must not take the morning briefing's
// schedule down with it.
export async function runDreamIfDue(now = Date.now()): Promise<DreamResult | null> {
  const day = localDate(now);
  // Turned away rather than queued: three entry points fire within seconds of a
  // launch, and a queue would run the night once per caller (gate.ts).
  if (!gate.enter(day)) return null;
  let finished = false;
  try {
    const state = await loadDreamState();
    if (!isDreamDue(state, now)) return null;

    // Before the stores are read, because the whole point is not to read them:
    // observations still sitting in a per-topic directory are about to move, and
    // a statement written against what a half-moved store answers would name a
    // file that is somewhere else by the time the reader presses the button
    // (docs/pitfall/210). The same judgement the migration button makes
    // (migrate/pending.ts), out of the same rule.
    if (await legacyObservationLayout(observationLayoutFs)) {
      logEvent(AI_EVENT_TOPIC, "dream-run", { outcome: "waiting-migration" });
      return standDown();
    }

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
