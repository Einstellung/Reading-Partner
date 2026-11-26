// The meals line's live state as a shell holds it (docs/73, docs/671): the
// household and the week, the batch cook's steps and its voice call, the day,
// recipe and prep session a shell without a navigation stack remembers itself,
// and the conversation that is up. Held by whoever mounts the meals screens
// (MealsHost.tsx draws them), so it outlives the screen being shown: a prep run
// and its call go on while the reader is elsewhere, and the call comes back as
// it was left.

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildGlossary } from "../../../ai/voice";
import { mealsAnchor, mealsKickoff, type MealsCallAnchor } from "../../../meals/conversation/anchor";
import { EMPTY_MEALS, type MealKey, type MealsState } from "../../../meals/plan/types";
import { batchCookEntry, entryTileView, type EntryAction, type EntryTileView } from "../../../meals/screen/batch-cook";
import { liveMealsPorts } from "../../../meals/live";
import { writtenMinutes } from "../../../meals/screen/prep-timeline";
import { recordPrepSessionEvent, startPrepSession, type PrepSteps } from "../../../meals/prep-session";
import { putMealsPrepCard } from "../../../meals/conversation/call";
import { runFor } from "../../../meals/timeline/view";
import { kitchenFor } from "../../../meals/timeline/schedule";
import type { MealsFocus } from "../../../meals/tools";
import type { StepEvent } from "../../../meals/timeline/run";
import type { HomeScreen } from "../base/shell-nav";
import type { ComposerVoice } from "../chat/composer-voice";
import { useMeals } from "./use-meals";
import { usePrepSteps } from "./use-prep-steps";
import { usePrepVoice } from "./use-prep-voice";

export interface MealsHostOptions {
  // Whether the meals line is shown (the Meals experiment). Off, nothing is
  // read off disk for it.
  enabled: boolean;
  // The screen showing, already narrowed to what is reachable.
  screen: HomeScreen | null;
  onNavigate: (screen: HomeScreen) => void;
  // How a shell with a navigation stack opens a prep session's page; without
  // one, the host remembers the session and switches to the page itself.
  onOpenMealsPrep?: (session: string) => void;
  // Called with a way to close the call whenever one opens, and with null when
  // it closes (the phone's global back, docs/22).
  onOverlayChange?: (dismiss: (() => void) | null) => void;
}

export function useMealsHost(opts: MealsHostOptions) {
  const { enabled, screen, onNavigate, onOpenMealsPrep, onOverlayChange } = opts;
  const meals = useMeals(enabled);
  // The batch cook's written steps: read for every place that shows its
  // minutes, and written on the spot when the prep page opens before the sweep
  // got to them (docs/671 菜品图).
  const prepSteps = usePrepSteps(meals.state, meals.today, screen === "meals-prep");
  const prepWritten = writtenMinutes(prepSteps.status, meals.state?.charter?.profile);
  // The day, recipe and prep session the desktop shell has open. It has no
  // navigation stack to hold them, and the phone's entry overrides these the
  // moment it supplies one.
  const [localDay, setLocalDay] = useState<string | null>(null);
  const [localRecipe, setLocalRecipe] = useState<MealKey | null>(null);
  const [localPrep, setLocalPrep] = useState<string | null>(null);
  // Where the desktop shell opened Method & sources from, to go back to it.
  const [methodFrom, setMethodFrom] = useState<HomeScreen>("meals");

  // The conversation that is up, if one is.
  const [call, setCall] = useState<MealsCallAnchor | null>(null);
  const closeCall = useCallback(() => setCall(null), []);
  // Report the open call upward, and take the report back when it closes. Only
  // while it is open: a shell's other surfaces report their own.
  useEffect(() => {
    if (!onOverlayChange || !call) return;
    onOverlayChange(() => setCall(null));
    return () => onOverlayChange(null);
  }, [call, onOverlayChange]);
  // The glossary anchors the STT cleanup pass on the conversation's title.
  const voice: ComposerVoice = useMemo(() => ({ glossary: buildGlossary({ title: call?.position.title }) }), [call]);

  const ask = useCallback(
    (state: MealsState, today: string, o?: { kickoff?: string; focus?: MealsFocus }) => setCall(mealsAnchor(state, today, o)),
    [],
  );
  // One standing thread for every screen; what the reader has open rides along
  // as the focus rather than forking it (docs/73).
  const openChat = (focus: MealsFocus, kickoff?: string) =>
    ask(meals.state ?? EMPTY_MEALS, meals.today, { focus, ...(kickoff ? { kickoff } : {}) });

  // The batch cook's ways in (docs/671 备餐页): its page, and the planning chat
  // over the Meals page, from the page's card, the home tile and Re-plan alike.
  const openPrep = (session: string) => {
    setLocalPrep(session);
    if (onOpenMealsPrep) onOpenMealsPrep(session);
    else onNavigate("meals-prep");
  };
  const planWeek = (state: MealsState | null = meals.state) => {
    if (screen !== "meals") onNavigate("meals");
    ask(state ?? EMPTY_MEALS, meals.today, { focus: { kind: "week" }, kickoff: mealsKickoff() });
  };
  const runAction = (action: EntryAction) => {
    if (action.kind === "plan") planWeek();
    else if (action.kind === "prep") openPrep(action.session);
    else onNavigate("meals");
  };
  // The phone home's Meals tile: null while info-meals.json is being read.
  const tile: EntryTileView | null = enabled
    ? entryTileView(batchCookEntry(meals.state, meals.today, new Date().getHours(), prepWritten), meals.today)
    : null;

  const prepPorts = () => liveMealsPorts({ today: () => meals.today, changed: meals.reload });
  // The run, its card in the meals conversation and its voice call
  // (docs/671 时间线与语音), held here so they outlive the prep page.
  const prepProfile = meals.state?.charter?.profile;
  const prepReady = prepSteps.status.kind === "ready" ? prepSteps.status : null;
  const prepTimeline: PrepSteps | null = useMemo(
    () =>
      prepReady
        ? { key: prepReady.key, steps: prepReady.steps, kitchen: kitchenFor(prepProfile), boxes: prepProfile?.boxes !== false }
        : null,
    [prepReady, prepProfile],
  );
  const prepPlanner = meals.state?.plan?.planner;
  const prepVoice = usePrepVoice({
    steps: prepTimeline,
    run: prepTimeline ? runFor(prepPlanner?.prepRun, prepTimeline.key) : null,
    done: typeof prepPlanner?.preppedAt === "number",
    ports: prepPorts,
  });
  const prepSession = () => ({ ports: prepPorts(), putCard: putMealsPrepCard });
  const startPrep = async () => {
    if (!prepTimeline) return false;
    // Asked for inside the tap, before anything is awaited: the call's audio wants the gesture.
    const requested = prepVoice.request();
    return (await startPrepSession(prepSession(), prepTimeline, () => requested)).kind === "started";
  };
  const recordPrep = (event: StepEvent) => {
    if (!prepTimeline) return;
    void recordPrepSessionEvent(prepSession(), prepTimeline, event).catch(() => {});
  };

  return {
    meals,
    prepSteps,
    prepWritten,
    prepVoice,
    prepPorts,
    startPrep,
    recordPrep,
    localDay,
    setLocalDay,
    localRecipe,
    setLocalRecipe,
    localPrep,
    methodFrom,
    setMethodFrom,
    call,
    closeCall,
    voice,
    openChat,
    openPrep,
    planWeek,
    runAction,
    tile,
  };
}

export type MealsHostState = ReturnType<typeof useMealsHost>;
