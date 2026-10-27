// The prep timeline's live half (docs/671 时间线与语音): the session's stored
// steps, written on the spot when the prep page opens before the background
// sweep got to them; the minute clock while a run is under way; the screen kept
// on; and a re-read of the plan when the app comes back to the front, so a run
// moved on another device shows up.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MealsState } from "../../../../info/meals/plan/types";
import { prepStepsRequest } from "../../../../info/meals/recipe/prep-steps";
import { storedPrepSteps, writePrepStepsOnce } from "../../../../info/meals/recipe/recipe-live";
import { hostRegion } from "../../../../info/meals/region";
import { msToNextMinute, type PrepStepsStatus } from "../../../../info/meals/screen/prep-timeline";
import { observeAppLifecycle } from "../../../../platform/app/lifecycle";
import { heldScreenWakeLock, type ScreenWakeLock } from "../../../../platform/app/wake-lock";
import { useRecipeLanguage } from "./use-recipe";

/**
 * The plan's prep steps. Read again whenever the state is (a sweep may have
 * written them since); written with a call only when `write` (the prep page is
 * open), and a failed call stays failed until `retry`.
 */
export function usePrepSteps(state: MealsState | null, today: string, write: boolean): { status: PrepStepsStatus; retry: () => void } {
  const language = useRecipeLanguage();
  const request = useMemo(
    () => (state && language ? prepStepsRequest(state, { today, region: hostRegion(), language }) : null),
    [state, today, language],
  );
  const [status, setStatus] = useState<PrepStepsStatus>({ kind: "none" });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(request);
  latest.current = request;
  const key = request?.key ?? null;

  useEffect(() => {
    const req = latest.current;
    if (!req) {
      setStatus({ kind: "none" });
      return;
    }
    let live = true;
    const same = (s: PrepStepsStatus) => s.kind === "ready" && s.key === req.key;
    setStatus((s) => (same(s) ? s : { kind: "reading" }));
    void (async () => {
      try {
        const stored = await storedPrepSteps(req);
        if (!live) return;
        if (stored) {
          setStatus((s) => (same(s) && s.kind === "ready" && s.at === stored.at ? s : { kind: "ready", key: req.key, at: stored.at, steps: stored.steps }));
          return;
        }
        if (!write) {
          setStatus({ kind: "none" });
          return;
        }
        setStatus({ kind: "writing" });
        const entry = await writePrepStepsOnce(req, "chat");
        if (live) setStatus({ kind: "ready", key: req.key, at: entry.at, steps: entry.steps });
      } catch {
        if (live) setStatus(write ? { kind: "failed" } : { kind: "none" });
      }
    })();
    return () => {
      live = false;
    };
  }, [key, attempt, write, state]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { status, retry };
}

/**
 * The time the timeline is read at: moved on at each whole minute of the run
 * by one timer, none before the start or once it is over. `refresh` reads the
 * clock now (the app came back to the front, where the timer was asleep).
 */
export function useRunClock(startedAt: number | null, clock: () => number): [number, () => void] {
  const [now, setNow] = useState(clock);
  const refresh = useCallback(() => setNow(clock()), [clock]);
  useEffect(() => {
    setNow(clock());
    if (startedAt === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      timer = setTimeout(() => {
        setNow(clock());
        arm();
      }, msToNextMinute(clock(), startedAt));
    };
    arm();
    return () => clearTimeout(timer);
  }, [startedAt, clock]);
  return [now, refresh];
}

/**
 * The screen kept on while `wanted`, given up on leaving the page. The lock
 * itself is handed back so a tap can ask for it inside the gesture, which
 * Safari wants (platform/app/wake-lock.ts). The prep's call holds the same
 * lock under its own name (use-prep-voice.ts), so neither drops the other's.
 */
export function useScreenWakeLock(wanted: boolean, holder = "prep-run"): ScreenWakeLock {
  const ref = useRef<ScreenWakeLock | null>(null);
  ref.current ??= heldScreenWakeLock(holder);
  const lock = ref.current;
  useEffect(() => lock.set(wanted), [lock, wanted]);
  useEffect(() => () => lock.set(false), [lock]);
  return lock;
}

/** Calls `fn` each time the app comes back to the front. */
export function useOnForeground(fn: () => void): void {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (typeof window === "undefined") return;
    return observeAppLifecycle(window, { onForeground: () => latest.current(), onBackground: () => {} });
  }, []);
}
