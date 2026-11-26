// The meals line's screens and its conversation (docs/73, docs/671), drawn from
// the state use-meals-host.ts holds. A shell mounts this wherever its home
// screens go and keeps the hook above it, so the run, the call and the
// remembered day outlive the screen being shown.
//
// Rendering and event binding only.

import { appliedAction } from "../../../meals/screen/batch-cook";
import { markPrepDone, saveProfile } from "../../../meals/apply";
import { planNote } from "../../../meals/screen/plan-note";
import { liveMealsPorts } from "../../../meals/live";
import { loadMeals } from "../../../meals/plan/store";
import type { MealKey } from "../../../meals/plan/types";
import type { Profile } from "../../../meals/nutrition/targets";
import { weekdayName } from "../../../meals/screen/view";
import type { HomeScreen } from "../base/shell-nav";
import { useT } from "../../../i18n";
import { isMealsScreen, mealsCallPosition } from "./host";
import type { MealsHostState } from "./use-meals-host";
import { MealsCall } from "./MealsCall";
import { MealsHome } from "./MealsPage";
import { MealsDay } from "./MealsDay";
import { MealsRecipe } from "./MealsRecipe";
import { MealsShopping } from "./MealsShopping";
import { MealsMethod } from "./MealsMethod";
import { MealsOnboarding } from "./MealsOnboarding";
import { MealsPrep } from "./MealsPrep";

// What a shell needs to put its own affordance around a screen that has
// something to talk about: the chat the screen's Ask button opens.
interface Askable {
  label: string;
  onAsk: () => void;
}

export function MealsHost(props: {
  host: MealsHostState;
  // The screen showing, already narrowed to what is reachable.
  screen: HomeScreen;
  onNavigate: (screen: HomeScreen) => void;
  // Whether the meals line is shown (the Meals experiment). Off, no screen is drawn.
  enabled: boolean;
  // Which day of the week the shell has open, and how it opens one. A shell
  // with a navigation stack (the phone's) puts the date on the stack entry and
  // hands it back here; a shell without one leaves both out.
  mealsDay?: string | null;
  onOpenMealsDay?: (date: string) => void;
  // Which meal's recipe is open over the day, and how one is opened: the same split.
  mealsRecipe?: MealKey | null;
  onOpenMealsRecipe?: (date: string, meal: MealKey) => void;
  // Which prep session's page is open (docs/671 备餐页).
  mealsPrep?: string | null;
  // Back from Method & sources and from a replayed onboarding, both opened from
  // more than one screen. The phone passes its stack's pop; the desktop leaves
  // it out and the host goes back to where it opened them.
  onMealsBack?: () => void;
  // A shell's own wrapper around a screen that has something to talk about
  // (the phone's pull-down-to-ask, docs/22).
  wrapScreen?: (screen: Askable, children: React.ReactNode) => React.ReactNode;
  // Whether the call keeps its corner cards (docs/03). The phone turns them off.
  pipCards?: boolean;
  onTopicsChanged?: () => void;
}) {
  const t = useT();
  const { host, screen, onNavigate } = props;
  const { meals } = host;

  const screens = (() => {
    if (!isMealsScreen(screen) || !props.enabled) return null;
    const openChat = host.openChat;
    const day = props.mealsDay ?? host.localDay;
    // The phone pushes the day onto its stack; the desktop and tablet shell
    // has no stack, so the host remembers the day and switches to it.
    const openDay = (date: string) => {
      host.setLocalDay(date);
      if (props.onOpenMealsDay) props.onOpenMealsDay(date);
      else onNavigate("meals-day");
    };
    const back = () => onNavigate("meals");
    const recipeMeal = props.mealsRecipe ?? host.localRecipe;
    const openRecipe = (meal: MealKey) => {
      if (!day) return;
      host.setLocalRecipe(meal);
      if (props.onOpenMealsRecipe) props.onOpenMealsRecipe(day, meal);
      else onNavigate("meals-recipe");
    };
    const backFromRecipe = () => (props.onMealsBack ? props.onMealsBack() : onNavigate("meals-day"));
    const backFromSide = () => (props.onMealsBack ? props.onMealsBack() : onNavigate(host.methodFrom));
    const openMethod = () => {
      host.setMethodFrom(screen);
      onNavigate("meals-method");
    };
    // Onboarding's last button: save the answers, then ask for the week with
    // the state as it now is, profile and all.
    const finishOnboarding = async (profile: Profile): Promise<boolean> => {
      const saved = await saveProfile(profile, liveMealsPorts({ today: () => meals.today, changed: meals.reload }));
      if (!saved.ok) return false;
      planNote.show(saved.check ?? null);
      const fresh = await loadMeals().catch(() => null);
      host.planWeek(fresh ?? meals.state);
      return true;
    };

    let inner: React.ReactNode;
    let ask: Askable;
    // Which screen the scroll container is showing. It keys the container, so
    // a new screen starts at its top instead of at wherever the last one was
    // scrolled to (they all share this one element otherwise).
    let shown: string;
    // The recipe is drawn over its day rather than in place of it, so the day
    // keeps its scroll and comes back as it was left.
    let over: React.ReactNode = null;
    if (screen === "meals-onboarding" || (screen === "meals" && meals.state && !meals.state.charter)) {
      const replay = screen === "meals-onboarding";
      shown = replay ? "onboarding-replay" : "onboarding";
      ask = { label: t("info.ask.aboutMeals"), onAsk: () => openChat({ kind: "week" }) };
      inner = (
        <MealsOnboarding
          key={replay ? "replay" : "first"}
          existing={meals.state?.charter?.profile ?? null}
          onFinish={finishOnboarding}
          {...(replay ? { onBack: backFromSide } : {})}
        />
      );
    } else if (screen === "meals-method") {
      shown = "method";
      ask = { label: t("info.ask.aboutNumbers"), onAsk: () => openChat({ kind: "week" }) };
      inner = <MealsMethod state={meals.state} onBack={backFromSide} />;
    } else if (screen === "meals-shopping") {
      shown = "shopping";
      ask = { label: t("info.ask.aboutShopping"), onAsk: () => openChat({ kind: "shopping" }) };
      inner = (
        <MealsShopping
          state={meals.state}
          photos={meals.photos}
          onBack={back}
          onAsk={ask.onAsk}
          onToggleItem={meals.toggleItem}
          onDone={meals.markDone}
        />
      );
    } else if ((screen === "meals-day" || screen === "meals-recipe") && day) {
      shown = `day:${day}`;
      if (screen === "meals-recipe" && recipeMeal) {
        over = (
          <div className="absolute inset-0 z-20 overflow-y-auto bg-background animate-in slide-in-from-right duration-300 motion-reduce:animate-none">
            <MealsRecipe
              state={meals.state}
              photos={meals.photos}
              today={meals.today}
              date={day}
              meal={recipeMeal}
              onBack={backFromRecipe}
            />
          </div>
        );
      }
      const label = day === meals.today ? t("info.ask.aboutToday") : t("info.ask.aboutWeekday", { weekday: weekdayName(day) });
      ask = { label, onAsk: () => openChat({ kind: "day", date: day }) };
      inner = (
        <MealsDay
          state={meals.state}
          photos={meals.photos}
          today={meals.today}
          date={day}
          onBack={back}
          onAsk={ask.onAsk}
          onOpenMethod={openMethod}
          onOpenRecipe={openRecipe}
        />
      );
    } else if (screen === "meals-prep") {
      shown = "prep";
      ask = { label: t("meals.askPlan"), onAsk: () => openChat({ kind: "week" }) };
      inner = (
        <MealsPrep
          state={meals.state}
          photos={meals.photos}
          today={meals.today}
          session={props.mealsPrep ?? host.localPrep}
          onBack={back}
          onAsk={ask.onAsk}
          onDone={() => void markPrepDone(host.prepPorts())}
          steps={host.prepSteps.status}
          onRetrySteps={host.prepSteps.retry}
          onStart={host.startPrep}
          onStep={host.recordPrep}
          voice={host.prepVoice.state}
          onResumeVoice={() => void host.prepVoice.request()}
          onForeground={meals.reload}
        />
      );
    } else {
      shown = "home";
      ask = { label: t("info.ask.aboutPlan"), onAsk: () => openChat({ kind: "week" }) };
      inner = (
        <MealsHome
          state={meals.state}
          photos={meals.photos}
          today={meals.today}
          onPlan={() => host.planWeek()}
          onOpenPrep={host.openPrep}
          written={host.prepWritten}
          onAsk={ask.onAsk}
          onOpenShopping={() => onNavigate("meals-shopping")}
          onOpenDay={openDay}
          onOpenMethod={openMethod}
          onReplayOnboarding={() => onNavigate("meals-onboarding")}
        />
      );
    }
    const page = (
      <div key={shown} className="absolute inset-0 overflow-y-auto bg-background">
        {inner}
      </div>
    );
    // The same pull-down everywhere: the phone's way into a chat is one gesture (docs/22).
    return (
      <>
        {props.wrapScreen ? props.wrapScreen(ask, page) : page}
        {over}
      </>
    );
  })();

  return (
    <>
      {screens}
      {host.call && (
        <MealsCall
          anchor={host.call}
          position={mealsCallPosition(host.call, meals.state)}
          onHangUp={host.closeCall}
          voice={host.voice}
          onTopicsChanged={props.onTopicsChanged}
          onMealsChanged={meals.reload}
          onOpenMeals={(to) => onNavigate(to)}
          // After a plan is applied, into its batch cook; a plan that cooks
          // nothing ahead lands on the Meals page.
          onMealsApplied={(session) => host.runAction(appliedAction(session))}
          pipCards={props.pipCards}
        />
      )}
    </>
  );
}
