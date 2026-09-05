// The info home screens (docs/16, docs/17): the vestibule, today's briefing, an
// opened article, the source list, and the info companion chat over them. App
// keeps only which screen is showing, since the header and the library branch on
// it too.
//
// Rendering and event binding only. The briefing view, the source list, the open
// article and the conversation that is up all live in use-info-home.ts.

import { savedArticleId } from "../../../reading/saved-articles";
import type { DeviceRole } from "../../../platform/app/device";
import type { InfoSnapshot } from "../../../info/briefing/pipeline";
import { todayLocal } from "../../../info/briefing/store";
import { liveProbeAndTrial } from "../../../info/sources/source-live";
import type { SignInSite } from "../../../info/sources/site-session";
import { Vestibule } from "./Vestibule";
import { BriefingPage } from "./BriefingPage";
import { SourcesPage } from "./SourcesPage";
import { ArticleView } from "./ArticleView";
import { InfoCall } from "./InfoCall";
import { VoiceOrbEntry } from "./VoiceOrbEntry";
import { useInfoHome } from "./use-info-home";

// The launch layer in front of the library. "library" belongs to App, which
// renders the shelf; it is in the union so the two navigate through one setter.
export type HomeScreen = "vestibule" | "library" | "briefing" | "article" | "sources";

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
  // The most recently opened book, for the vestibule's Continue reading. Null
  // when there is none; undefined while the shell has not read the library yet,
  // which the vestibule draws as a placeholder rather than as an empty shelf.
  continueBook?: { title: string; topicName: string } | null;
  onContinue?: () => void;
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
  // Whether the call keeps its corner cards (docs/03). Default, and the desktop
  // shell: it does. The phone shell turns them off — there the chat is a screen
  // of the navigation stack with gestures in and out of it, and a card that
  // swaps it away would be a second way to leave, eating a corner of a 393pt
  // screen to offer it.
  pipCards?: boolean;
}) {
  const { screen, onNavigate } = props;
  const info = useInfoHome({
    role: props.role,
    onNavigate,
    onTopicsChanged: props.onTopicsChanged,
    onOverlayChange: props.onOverlayChange,
  });

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
              snap={info.snap}
              ready={props.launchReady}
              configured={props.configured}
              hasSources={info.hasSources}
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
              onAppeal={info.appealItem}
              onAskBriefing={info.askBriefing}
              onAskArticle={info.askArticle}
              onOpenSources={info.openSourcesPage}
              onBack={() => onNavigate("vestibule")}
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
            {!info.infoCall && <VoiceOrbEntry dateKey={info.snap?.briefing?.date ?? todayLocal()} />}
          </>
        );
      })()}

      {screen === "sources" && (
        <div className="absolute inset-0 overflow-y-auto bg-background">
          <SourcesPage
            sources={info.sources}
            health={info.sourceHealth}
            sessions={info.siteSessions}
            sessionBusy={info.sessionBusy}
            {...(info.canSignIn
              ? {
                  onSignIn: (site: SignInSite) => void info.signInToSite(site),
                  onCheckSession: (site: SignInSite) => void info.checkSession(site),
                  onSignOut: (site: SignInSite) => void info.signOutOfSite(site),
                }
              : {})}
            // Adding a source is the collector's (docs/36): a trial has to prove
            // the full text can be had, and this machine cannot fetch one.
            {...(info.collecting
              ? { onProbeAdd: liveProbeAndTrial, onConfirmAdd: info.confirmAddSource }
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
          onOpenBriefing={() => onNavigate("briefing")}
          pipCards={props.pipCards}
        />
      )}
    </>
  );
}
