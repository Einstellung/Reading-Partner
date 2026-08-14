// The phone shell (docs/22), beside App.tsx. Info only: today's briefing, the
// articles it produced, the ones kept out of it, the companion chat over any of
// them, and settings. No reader, no annotations, no notes — the phone never
// opens a book, so none of App's reading state exists here.
//
// The briefing pipeline, the article cache and the info call stay in InfoHome,
// which both shells mount; this file owns where the reader is — a navigation
// stack (nav-stack.ts) whose floor is home — plus the kept articles, settings
// and sync.
//
// Back has one definition, `goBack`, and three things reach it: the top bar
// button on every screen, the left-edge swipe, and the Android system button.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bindSystemBack } from "./platform/app/back-button";
import { BRIEF_TOPIC_ID } from "./platform/app/topics";
import { initSync } from "./platform/sync";
import { registerPullRoute } from "./platform/sync/pull-routes";
import { KEPT_ARTICLES_PULL_ROUTE } from "./reading/pull-routes";
import {
  loadSavedArticles,
  savedArticlesForTopic,
  type SavedArticle,
} from "./reading/saved-articles";
import { CardRegistryProvider } from "./ui/components/CardRegistryProvider";
import InfoHome, { type HomeScreen } from "./ui/components/info/InfoHome";
import PhoneHome from "./ui/components/phone/PhoneHome";
import { PullToAsk } from "./ui/components/phone/PullToAsk";
import SavedList from "./ui/components/phone/SavedList";
import {
  back,
  backIsAvailable,
  baseScreen,
  goTo,
  INITIAL_STACK,
  push,
  resolveBack,
  screen,
  top,
  type NavStack,
  type PhoneScreen,
} from "./ui/components/phone/nav-stack";
import { useEdgeBack } from "./ui/components/phone/useEdgeBack";
import SavedArticleView from "./ui/components/library/SavedArticleView";
import SettingsView from "./ui/components/SettingsView";
import Toast, { useToasts } from "./ui/components/common/Toast";
import { useShellBootstrap } from "./ui/components/common/useShellBootstrap";

// InfoHome's screen for a stack entry, or null on the ones it does not draw.
// Null keeps it mounted with its pipeline and its opened article intact, the
// same way App parks it while the reader is open.
function infoScreenFor(base: PhoneScreen): HomeScreen | null {
  switch (base.kind) {
    case "home":
      return "vestibule";
    case "briefing":
      return "briefing";
    case "article":
      return "article";
    case "sources":
      return "sources";
    default:
      return null;
  }
}

export default function PhoneApp() {
  const [stack, setStack] = useState<NavStack>(INITIAL_STACK);
  // The kept articles (docs/21). Fixed to the Brief topic: the phone has no
  // other place to file one from. The one being read is a stack entry.
  // Null until saved-articles.json has been read: "Nothing kept yet" is a claim
  // about a file nobody has opened.
  const [savedArticles, setSavedArticles] = useState<SavedArticle[] | null>(null);
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  // The info call InfoHome draws over its screens. It is not a stack entry, so
  // back closes it instead of navigating underneath it; the ref keeps goBack
  // stable, and the flag is what arms the gesture and the Android button when
  // the stack itself is at its floor.
  const dismissOverlayRef = useRef<(() => void) | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const onOverlayChange = useCallback((dismiss: (() => void) | null) => {
    dismissOverlayRef.current = dismiss;
    setOverlayOpen(!!dismiss);
  }, []);

  const base = baseScreen(stack);
  const showSettings = top(stack).kind === "settings";
  // The same start-up as App: both settings files, the provider list, the
  // sync-health verdict, and the store error hooks. This phone is always a
  // reader, so nothing device.json says here changes what it collects — it is
  // held for the Settings panel and for the identity the ask files are named by.
  const {
    settings,
    applySettings,
    device,
    applyDevice,
    configured,
    ready: bootstrapped,
    syncReport,
  } = useShellBootstrap({ settingsOpen: showSettings, pushToast });

  // The one back. The three things that trigger it — a top bar button, the
  // left-edge swipe, the Android button — all arrive here. Both inputs come
  // from refs so the callback stays stable: it is handed to a gesture hook and
  // to a plugin listener, neither of which should be rebound on a navigation.
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const goBack = useCallback(() => {
    switch (resolveBack(stackRef.current, dismissOverlayRef.current !== null)) {
      case "dismissOverlay":
        dismissOverlayRef.current?.();
        break;
      case "pop":
        setStack((s) => back(s));
        break;
      default:
        break;
    }
  }, []);

  const refreshSavedArticles = useCallback(async () => {
    const all = await loadSavedArticles().catch((): SavedArticle[] => []);
    setSavedArticles(savedArticlesForTopic(all, BRIEF_TOPIC_ID));
  }, []);

  // The kept list is this shell's own: it is most of what the phone shows, and
  // nothing in the shared bootstrap knows about it.
  useEffect(() => {
    void refreshSavedArticles();
  }, [refreshSavedArticles]);

  // Account sync (docs/13). The kept articles are what this shell mostly shows
  // and they arrive over sync, so a pulled saved-articles.json reloads the list.
  // Every other file a pull writes has a route of its own (platform/sync/
  // pull-routes.ts), settings.json included — this shell holds it whole in
  // memory and saves it whole, so a field merged in from another device is
  // undone by the next save unless the shared bootstrap reads the copy back.
  useEffect(() => {
    // "phone": the books channel stays off here, since nothing on this shell
    // can open a PDF (docs/22).
    void initSync("phone").catch((e) => console.warn("sync init failed", e));
    return registerPullRoute({
      ...KEPT_ARTICLES_PULL_ROUTE,
      onPulled: () => void refreshSavedArticles(),
    });
  }, [refreshSavedArticles]);

  // The Android button, bound only while back has somewhere to go: with nothing
  // to close and nothing to pop it belongs to the system, which leaves the app
  // (see platform/app/back-button.ts).
  const backable = backIsAvailable(stack, overlayOpen);
  useEffect(() => {
    if (!backable) return;
    return bindSystemBack(goBack);
  }, [backable, goBack]);

  // The left-edge swipe drives the same back, and slides this element while the
  // finger is down.
  const surfaceRef = useEdgeBack(
    useMemo(() => ({ enabled: backable, onBack: goBack }), [backable, goBack]),
  );

  // InfoHome navigates by naming a destination, and uses the same call for its
  // own top bar backs ("briefing" from an article). goTo unwinds to a screen
  // already on the stack, so those stay backs instead of stacking a second copy.
  // "library" cannot arrive: the phone home screen has no way there.
  const onNavigate = useCallback((next: HomeScreen) => {
    const kind = next === "vestibule" || next === "library" ? "home" : next;
    setStack((s) => goTo(s, screen(kind)));
  }, []);

  const openSettings = useCallback(() => setStack((s) => push(s, screen("settings"))), []);

  return (
    // The backdrop the swipe reveals, and the clip that hides whatever has left
    // the screen. Only ever visible while a gesture or its animation is running.
    <div className="relative h-full overflow-hidden bg-[#f1f3f5]">
      {/* p-safe: the notch and the home indicator (viewport-fit=cover). Fixed
          overlays are not covered by it and pad themselves — docs/pitfall/74. */}
      <div ref={surfaceRef} className="flex h-full flex-col bg-white p-safe">
        {/* No shell header: every screen carries its own top bar, and a second
            one above them would cost a phone a line of reading height for
            nothing. */}
        <main className="relative min-h-0 flex-1">
          {/* The chat card table (docs/17's probe cards, the briefing card).
              chat/ reads it from a context, so it never imports the domains that
              fill it, and a shell that leaves this out renders no card at all. */}
          <CardRegistryProvider>
          <InfoHome
            screen={infoScreenFor(base)}
            onNavigate={onNavigate}
            role={device?.role ?? null}
            configured={configured}
            launchReady={bootstrapped}
            onOpenSettings={openSettings}
            onTopicsChanged={refreshSavedArticles}
            onOverlayChange={onOverlayChange}
            // Pull down on the briefing or on an article to open the chat about
            // it. Only those two: home and the kept list have nothing to talk
            // about, and a kept article is still invisible to the AI (docs/21),
            // so a chat over one would not know what it was reading. The gesture
            // is this shell's, so it is this shell that wraps the screen in it.
            wrapScreen={(screen, children) => <PullToAsk {...screen}>{children}</PullToAsk>}
            // No corner cards over the chat. The reader pulled it down or
            // pressed Ask and pops it with a back, so the chat is a screen like
            // any other; a card that shrank it away would be a second way out,
            // parked in a corner of a screen 393pt wide.
            pipCards={false}
            renderLaunch={(launch) => (
              <PhoneHome
                launch={launch}
                savedCount={savedArticles?.length ?? null}
                onOpenSaved={() => setStack((s) => push(s, screen("saved")))}
                settingsAlert={syncReport.alert !== "none"}
              />
            )}
          />

          {base.kind === "saved" && (
            <SavedList
              articles={savedArticles ?? []}
              onOpen={(article) => setStack((s) => push(s, { kind: "savedArticle", article }))}
              onBack={goBack}
            />
          )}

          {base.kind === "savedArticle" && (
            <SavedArticleView article={base.article} backLabel="Saved" onBack={goBack} />
          )}
          </CardRegistryProvider>
        </main>

        <Toast toasts={toasts} onDismiss={dismissToast} />

        {showSettings && (
          <SettingsView
            settings={settings}
            onSettingsChange={applySettings}
            device={device}
            onDeviceChange={applyDevice}
            onClose={goBack}
          />
        )}
      </div>
    </div>
  );
}
