// The info home screens (docs/16, docs/17): the vestibule, today's briefing, an
// opened article, the source list, and the info companion chat over them. App
// keeps only which screen is showing, since the header and the library branch on
// it too.
//
// Rendering and event binding only. The briefing view, the source list, the open
// article and the conversation that is up all live in use-info-home.ts.

import { useState } from "react";
import { savedArticleId } from "../../../reading/saved-articles";
import type { HomeScreen } from "../base/shell-nav";
import type { DeviceRole } from "../../../platform/app/device";
import type { FileRef, Topic } from "../../../platform/app/topics";
import type { InfoSnapshot } from "../../../info/boxes/pipeline";
import { todayLocal } from "../../../info/collect/store";
import { MEALS_KICKOFF } from "../../../info/briefer/anchors";
import { EMPTY_MEALS } from "../../../info/meals/types";
import type { SignInSite } from "../../../info/sources/site-session";
import { Vestibule } from "./Vestibule";
import { BriefingPage } from "./BriefingPage";
import { SourcesPage } from "./SourcesPage";
import { ArticleView } from "./ArticleView";
import { InfoCall } from "./InfoCall";
import { MealsHome } from "./MealsPage";
import { MealsDay } from "./MealsDay";
import { MealsShopping } from "./MealsShopping";
import { MealsMethod } from "./MealsMethod";
import { MealsOnboarding } from "./MealsOnboarding";
import { saveProfile } from "../../../info/meals/apply";
import { liveMealsPorts } from "../../../info/meals/live";
import { loadMeals } from "../../../info/meals/store";
import type { Profile } from "../../../info/meals/nutrition/targets";
import { useMeals } from "./use-meals";
import type { MealsFocus } from "../../../info/meals/tools";
import { weekdayName } from "../../../info/meals/view";
import { useInfoHome } from "./use-info-home";
import { useRegisterVoiceContext } from "../lumen/voice-context";
import { noLabsOpen } from "./no-labs";

// The screen union lives in base/shell-nav.ts, which is what maps it to the
// shell's sidebar; re-exported here so its importers are unchanged.
export type { HomeScreen } from "../base/shell-nav";

// The three screens of the meals line. They share one hook, one thread and one
// sidebar item, so they are drawn by one branch.
function isMealsScreen(screen: HomeScreen | null): boolean {
  return (
    screen === "meals" ||
    screen === "meals-shopping" ||
    screen === "meals-day" ||
    screen === "meals-method" ||
    screen === "meals-onboarding"
  );
}

// What a shell needs to know to put its own affordance around a screen that has
// something to talk about: the chat the screen's Ask button opens, in the
// reader's words and as a callback. The phone shell wraps these two screens in
// its pull-down gesture (docs/22); the desktop shell wraps neither.
export interface AskableScreen {
  // "Ask about this article", for the affordance to show before it fires.
  label: string;
  onAsk: () => void;
}

// Everything a launch screen needs from the briefing pipeline. The state lives
// here, so a shell that draws its own launch screen (the phone's, docs/22) is
// handed these rather than subscribing a second time.
export interface LaunchProps {
  snap: InfoSnapshot | null;
  // Whether the reads a launch card branches on have answered. False is not "no"
  // — it is "nobody has looked yet", and a card drawn from the defaults standing
  // in for those answers says the wrong thing and then says a different one.
  ready: boolean;
  configured: boolean;
  hasSources: boolean | null;
  // Whether every research room is closed, null while the labs file is being
  // read (no-labs.ts). With none open the collection gate declines and nothing
  // is briefed, and the launch card is the only place that says so.
  noLabs: boolean | null;
  // Whether this device is the one collecting (docs/36). A reader has no button
  // that starts a briefing and nothing to say about a run it is not doing.
  collecting: boolean;
  // What to say about the machine that collects, when it is not this one.
  notices: string[];
  onAsk: () => void;
  onStop: () => void;
  onOpenBriefing: () => void;
  onOpenSettings: () => void;
  onStartSubscribing: () => void;
}

export default function InfoHome(props: {
  // Which screen to show, or null while the reader is open (the pipeline
  // subscription lives on regardless, so a briefing keeps generating).
  screen: HomeScreen | null;
  onNavigate: (screen: HomeScreen) => void;
  // The launch screen to draw in place of the vestibule. Omitted by the desktop
  // shell, which wants the vestibule; the phone shell has no library and no
  // book to continue, so it draws its own.
  renderLaunch?: (launch: LaunchProps) => React.ReactNode;
  // The most recently opened book, for Today's Continue reading. Null when there
  // is none; undefined while the shell has not read the library yet, which Today
  // draws as a placeholder rather than as an empty shelf.
  continueBook?: { file: FileRef; topicName: string } | null;
  onContinue?: () => void;
  // The shelf Today shows a row of, null while it is being read. Omitted by the
  // phone shell, which has no library (docs/22).
  topics?: Topic[] | null;
  onOpenTopic?: (topic: Topic) => void;
  onCreateTopic?: (name: string) => void;
  // Whether an AI provider is connected (the vestibule guides to Settings).
  configured: boolean;
  // Whether the shell's start-up reads have answered (useShellBootstrap). The
  // launch screen holds a placeholder until they have: `configured` and `role`
  // both have a value from the first render, and before this is true neither of
  // them came from a file.
  launchReady: boolean;
  // What this device is for (docs/36), null until device.json has been read.
  // It decides which briefing view is built, and with it whether this screen
  // can collect, add a source, or start a run at all. Nothing info-related is
  // constructed until it lands: building a collector's singletons on a machine
  // that turns out to be a reader is the mistake that costs money.
  role: DeviceRole | null;
  onOpenSettings: () => void;
  // Keeping an article can create the Brief topic, so the shelf needs a reload.
  onTopicsChanged: () => Promise<void> | void;
  // Called with a way to close the info call whenever one opens, and with null
  // when it closes. For a shell whose back is global (the phone's: a left-edge
  // swipe and the Android button, neither of which can aim at a close button) —
  // back has to close the call before it navigates, or hanging up leaves the
  // reader on a screen they never chose. Omitted by the desktop shell, where
  // back is the call's own Hang up.
  onOverlayChange?: (dismiss: (() => void) | null) => void;
  // A shell's own wrapper around the two screens that have something to talk about
  // about, the briefing and an article. The phone (docs/22) returns them inside
  // its pull-down-to-ask host, so a pull from the top opens the same chat the
  // Ask button opens; the desktop shell omits this and gets exactly what it drew
  // before. A render prop rather than a flag, so the gesture stays in the shell
  // that has it and this screen keeps importing nothing from either shell —
  // the same hole renderLaunch is (docs/22).
  wrapScreen?: (screen: AskableScreen, children: React.ReactNode) => React.ReactNode;
  // Whether the meals line is switched on (settings.meals, docs/73). Off, and
  // there is no entry to this screen anywhere and nothing is read off disk for
  // it; the data stays where it is.
  mealsEnabled?: boolean;
  // Which day of the week the shell has open, and how it opens one. The day is
  // one screen of a week, so a shell with a navigation stack (the phone's) puts
  // the date on the stack entry and hands it back here; a shell without one
  // (the desktop's) leaves both out and this screen remembers it itself.
  mealsDay?: string | null;
  onOpenMealsDay?: (date: string) => void;
  // Back from Method & sources and from a replayed onboarding, both of which
  // are opened from more than one screen. The phone passes its stack's pop; the
  // desktop leaves it out and this screen goes back to where it opened them.
  onMealsBack?: () => void;
  // Whether the call keeps its corner cards (docs/03). Default, and the desktop
  // shell: it does. The phone shell turns them off — there the chat is a screen
  // of the navigation stack with gestures in and out of it, and a card that
  // swaps it away would be a second way to leave, eating a corner of a 393pt
  // screen to offer it.
  pipCards?: boolean;
}) {
  const { screen, onNavigate } = props;
  const meals = useMeals(props.mealsEnabled === true);
  // The day the desktop shell has open. It has no navigation stack to hold it,
  // and the phone's entry overrides this the moment it supplies one.
  const [localMealsDay, setLocalMealsDay] = useState<string | null>(null);
  // Where the desktop shell opened Method & sources from, to go back to it.
  const [methodFrom, setMethodFrom] = useState<HomeScreen>("meals");
  const info = useInfoHome({
    role: props.role,
    onNavigate,
    onTopicsChanged: props.onTopicsChanged,
    onOverlayChange: props.onOverlayChange,
  });

  // What a hold on Lumen would be about (docs/68). The briefing screen is the
  // one place with a day's thread to talk about, so it publishes it for the
  // corner, which is a sibling of both shells and cannot be handed it as a
  // prop. Not while the text call is up: that is the same conversation in the
  // other medium, and two of them on one screen is two microphones' worth of
  // the same day.
  useRegisterVoiceContext(
    screen === "briefing" && info.snap?.briefing && !info.infoCall
      ? { dateKey: info.snap.briefing.date, briefing: info.snap.briefing }
      : null,
  );

  if (screen === null) return null;

  return (
    <>
      {screen === "vestibule" && (
        <div className="absolute inset-0 overflow-y-auto bg-background">
          {props.renderLaunch ? (
            props.renderLaunch({
              snap: info.snap,
              ready: props.launchReady,
              configured: props.configured,
              hasSources: info.hasSources,
              noLabs: noLabsOpen(info.labs),
              collecting: info.collecting,
              notices: info.notices,
              onAsk: () => void info.askLaunch(),
              onStop: info.stopBriefing,
              onOpenBriefing: () => onNavigate("briefing"),
              onOpenSettings: props.onOpenSettings,
              onStartSubscribing: info.openOnboarding,
            })
          ) : (
            <Vestibule
              continueBook={props.continueBook}
              topics={props.topics ?? null}
              onOpenTopic={props.onOpenTopic ?? (() => {})}
              onCreateTopic={props.onCreateTopic ?? (() => {})}
              snap={info.snap}
              ready={props.launchReady}
              configured={props.configured}
              hasSources={info.hasSources}
              noLabs={noLabsOpen(info.labs)}
              collecting={info.collecting}
              notices={info.notices}
              onContinue={props.onContinue ?? (() => {})}
              onOpenLibrary={() => onNavigate("library")}
              onAsk={() => void info.askLaunch()}
              onStop={info.stopBriefing}
              onOpenBriefing={() => onNavigate("briefing")}
              onOpenSettings={props.onOpenSettings}
              onStartSubscribing={info.openOnboarding}
            />
          )}
        </div>
      )}

      {screen === "briefing" && info.snap?.briefing && (() => {
        const page = (
          <div className="absolute inset-0 overflow-y-auto bg-background">
            <BriefingPage
              briefing={info.snap.briefing}
              openedIds={info.openedItemIds}
              dismissedIds={info.dismissedItemIds}
              onOpenArticle={info.openArticle}
              onDismiss={info.dismissItem}
              onAskBriefing={info.askBriefing}
              onAskArticle={info.askArticle}
              onOpenSources={info.openSourcesPage}
            />
          </div>
        );
        const wrapped = props.wrapScreen
          ? props.wrapScreen({ label: "Ask about today's briefing", onAsk: () => void info.askBriefing() }, page)
          : page;
        // The voice orb belongs to this screen and only to it (docs/33): it is
        // the briefing being talked about. Not while the text call is up —
        // that is the same conversation in the other medium, and the two would
        // otherwise be stacked on one screen with the orb painting over the
        // call's corner card.
        return (
          <>
            {wrapped}
            {/* The corner entry is Lumen's, in every shell and on every screen
                (ui/components/lumen/LumenCorner, docs/68): a long press there
                opens the session and a second one ends it. This screen draws
                none of it and only says what it would be about, above. */}
          </>
        );
      })()}

      {isMealsScreen(screen) && props.mealsEnabled && (() => {
        // One standing thread for all three screens; what the reader has open
        // rides along as the focus rather than forking it (docs/73).
        const openChat = (focus: MealsFocus, kickoff?: string) =>
          info.askMeals(meals.state ?? EMPTY_MEALS, meals.today, {
            focus,
            ...(kickoff ? { kickoff } : {}),
          });
        const day = props.mealsDay ?? localMealsDay;
        const openDay = (date: string) => {
          setLocalMealsDay(date);
          props.onOpenMealsDay?.(date);
        };
        const back = () => onNavigate("meals");
        const backFromSide = () => (props.onMealsBack ? props.onMealsBack() : onNavigate(methodFrom));
        const openMethod = () => {
          setMethodFrom(screen);
          onNavigate("meals-method");
        };
        // Onboarding's last button: save the answers, then ask for the week
        // with the state as it now is, profile and all.
        const finishOnboarding = async (profile: Profile): Promise<boolean> => {
          const saved = await saveProfile(
            profile,
            liveMealsPorts({ today: () => meals.today, changed: meals.reload }),
          );
          if (!saved.ok) return false;
          const fresh = await loadMeals().catch(() => null);
          if (screen !== "meals") onNavigate("meals");
          info.askMeals(fresh ?? meals.state ?? EMPTY_MEALS, meals.today, {
            focus: { kind: "week" },
            kickoff: MEALS_KICKOFF,
          });
          return true;
        };

        let inner: React.ReactNode;
        let ask: AskableScreen;
        if (screen === "meals-onboarding" || (screen === "meals" && meals.state && !meals.state.charter)) {
          const replay = screen === "meals-onboarding";
          ask = { label: "Ask about meals", onAsk: () => openChat({ kind: "week" }) };
          inner = (
            <MealsOnboarding
              key={replay ? "replay" : "first"}
              existing={meals.state?.charter?.profile ?? null}
              onFinish={finishOnboarding}
              {...(replay ? { onBack: backFromSide } : {})}
            />
          );
        } else if (screen === "meals-method") {
          ask = { label: "Ask about the numbers", onAsk: () => openChat({ kind: "week" }) };
          inner = <MealsMethod state={meals.state} onBack={backFromSide} />;
        } else if (screen === "meals-shopping") {
          ask = { label: "Ask about shopping", onAsk: () => openChat({ kind: "shopping" }) };
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
        } else if (screen === "meals-day" && day) {
          const label =
            day === meals.today ? "Ask about today" : `Ask about ${weekdayName(day)}`;
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
            />
          );
        } else {
          ask = { label: "Ask about this week", onAsk: () => openChat({ kind: "week" }) };
          inner = (
            <MealsHome
              state={meals.state}
              photos={meals.photos}
              today={meals.today}
              onPlanWeek={() => openChat({ kind: "week" }, MEALS_KICKOFF)}
              onAsk={ask.onAsk}
              onOpenShopping={() => onNavigate("meals-shopping")}
              onOpenDay={openDay}
              onOpenMethod={openMethod}
              onReplayOnboarding={() => onNavigate("meals-onboarding")}
            />
          );
        }
        const page = (
          <div className="absolute inset-0 overflow-y-auto bg-background">{inner}</div>
        );
        // The same pull-down the briefing has, on all three: the phone's way
        // into a chat is one gesture everywhere (docs/22).
        return props.wrapScreen ? props.wrapScreen(ask, page) : page;
      })()}

      {screen === "sources" && (
        <div className="absolute inset-0 overflow-y-auto bg-background">
          <SourcesPage
            sources={info.sources}
            health={info.sourceHealth}
            labs={info.labs ?? []}
            sessions={info.siteSessions}
            sessionBusy={info.sessionBusy}
            {...(info.canSignIn
              ? {
                  onSignIn: (site: SignInSite) => void info.signInToSite(site),
                  onCheckSession: (site: SignInSite) => void info.checkSession(site),
                  onSignOut: (site: SignInSite) => void info.signOutOfSite(site),
                }
              : {})}
            collectorSites={info.collectorSites}
            onToggle={info.toggleSource}
            onRemove={info.removeSourceById}
            onBack={() => onNavigate("briefing")}
          />
        </div>
      )}

      {screen === "article" && info.openArticleId && info.snap?.briefing && (() => {
        const openArticleId = info.openArticleId;
        const meta =
          info.snap.briefing.items[openArticleId] ?? {
            title: "Article",
            url: "",
            source: "",
            sourceName: "",
            publishedAt: "",
          };
        const view = (
          <ArticleView
            meta={meta}
            state={info.articleState}
            saved={info.keptIds.has(savedArticleId(meta.url, meta.title))}
            onBack={() => onNavigate("briefing")}
            onAsk={() => info.askArticle(openArticleId)}
            // A keep over an unreadable topics.json refuses rather than writing
            // a shelf holding only the Brief topic, and the reader has already
            // been told which file and where its bytes went (atomic-fs). What is
            // left here is not to raise it a second time as a loose rejection.
            onSave={() => {
              info.keepArticle(openArticleId).catch(() => {});
            }}
          />
        );
        // The article view's own root is the scroll container, so it is the
        // child a wrapper receives directly; the plain box is what the desktop
        // shell has always drawn around it.
        return props.wrapScreen
          ? props.wrapScreen({ label: "Ask about this article", onAsk: () => void info.askArticle(openArticleId) }, view)
          : <div className="absolute inset-0">{view}</div>;
      })()}

      {info.infoCall && info.view && (
        <InfoCall
          anchor={info.infoCall}
          dateKey={info.snap?.briefing?.date ?? todayLocal()}
          view={info.view}
          collecting={info.collecting}
          onHangUp={info.closeCall}
          voice={info.infoVoice}
          onSourcesChanged={info.refreshSources}
          onTopicsChanged={() => void props.onTopicsChanged()}
          onOpenBriefing={() => onNavigate("briefing")}
          onMealsChanged={meals.reload}
          pipCards={props.pipCards}
        />
      )}
    </>
  );
}
