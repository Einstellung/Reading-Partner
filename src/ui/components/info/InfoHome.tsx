// The info home screens (docs/16, docs/17): the vestibule, today's briefing, an
// opened article, the source list, and the info companion chat over them. App
// keeps only which screen is showing, since the header and the library branch on
// it too.
//
// Rendering and event binding only. The briefing view, the source list, the open
// article and the conversation that is up all live in use-info-home.ts.

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
import { DinnerPage } from "./DinnerPage";
import { useDinner } from "./use-dinner";
import { useInfoHome } from "./use-info-home";
import { useRegisterVoiceContext } from "../lumen/voice-context";
import { noLabsOpen } from "./no-labs";

// The screen union lives in base/shell-nav.ts, which is what maps it to the
// shell's sidebar; re-exported here so its importers are unchanged.
export type { HomeScreen } from "../base/shell-nav";

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
  dinnerEnabled?: boolean;
  // Whether the call keeps its corner cards (docs/03). Default, and the desktop
  // shell: it does. The phone shell turns them off — there the chat is a screen
  // of the navigation stack with gestures in and out of it, and a card that
  // swaps it away would be a second way to leave, eating a corner of a 393pt
  // screen to offer it.
  pipCards?: boolean;
}) {
  const { screen, onNavigate } = props;
  const dinner = useDinner(props.dinnerEnabled === true);
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

      {screen === "dinner" && props.dinnerEnabled && (() => {
        const openChat = (kickoff?: string) => info.askDinner(dinner.state ?? EMPTY_MEALS, dinner.today, kickoff);
        const page = (
          <div className="absolute inset-0 overflow-y-auto bg-background">
            <DinnerPage
              state={dinner.state}
              photos={dinner.photos}
              today={dinner.today}
              onPlanWeek={() => openChat(MEALS_KICKOFF)}
              onAsk={() => openChat()}
              onToggleItem={dinner.toggleItem}
            />
          </div>
        );
        // The same pull-down the briefing has: dinner is a screen with
        // something to talk about, and the phone's way into a chat is one
        // gesture everywhere (docs/22).
        return props.wrapScreen
          ? props.wrapScreen({ label: "Ask about dinner", onAsk: () => openChat() }, page)
          : page;
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
          onMealsChanged={dinner.reload}
          pipCards={props.pipCards}
        />
      )}
    </>
  );
}
