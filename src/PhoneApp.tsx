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

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { bindSystemBack } from "./platform/app/back-button";
import { BRIEF_TOPIC_ID, listTopics, type Topic } from "./platform/app/topics";
import { listLibraryEntries, type LibraryEntry } from "./platform/app/library";
import {
  libraryFilePath,
  openIn,
  openInAvailable,
  shareFileName,
} from "./platform/app/open-in";
import FlowReaderPane from "./reading/epub/flow/FlowReaderPane";
import type { FlowReaderPaneProps } from "./reading/epub/flow/flow-contract";
import { registerPullRoute } from "./platform/sync/pull-routes";
import { KEPT_ARTICLES_PULL_ROUTE } from "./reading/pull-routes";
import {
  loadSavedArticles,
  savedArticlesForTopic,
  type SavedArticle,
} from "./reading/saved/saved-articles";
import { registerPlaces } from "./desk";
import { PHONE_PLACES, shellPlaces } from "./ui/components/base/places";
import { CardRegistryProvider } from "./ui/components/CardRegistryProvider";
import InfoHome, { type HomeScreen } from "./ui/components/info/InfoHome";
import PhoneHome from "./ui/components/phone/PhoneHome";
import { LumenCorner } from "./ui/components/lumen/LumenCorner";
import { useCornerLift } from "./ui/components/lumen/use-corner-lift";
import { ComposerSlotContext } from "./ui/components/chat/call/composer-slot";
import {
  readLumenCornerShown,
  writeLumenCornerShown,
} from "./ui/components/lumen/corner-pref";
import { browserPrefStore } from "./ui/components/base/pref-store";
import { PullToAsk } from "./ui/components/phone/gesture/PullToAsk";
import PhoneReader from "./ui/components/phone/reader/PhoneReader";
import PhoneLessonScreen from "./ui/components/phone/lesson/PhoneLessonScreen";
import PhoneLessonIntroSheet from "./ui/components/phone/lesson/PhoneLessonIntroSheet";
import PhoneShelf, { type PhoneBookOpen } from "./ui/components/phone/PhoneShelf";
import { continueReading } from "./ui/components/phone/shelf-list";
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
import { useEdgeBack } from "./ui/components/phone/gesture/useEdgeBack";
import SavedArticleView from "./ui/components/library/SavedArticleView";
import SettingsDialog from "./ui/components/SettingsDialog";
import Toast, { useToasts } from "./ui/components/common/Toast";
import TranslateStatus from "./ui/components/reader/TranslateStatus";
import { useShellBootstrap } from "./ui/components/common/useShellBootstrap";
import { KeyboardShell } from "./ui/components/common/KeyboardShell";
import { useBackgroundServices } from "./ui/components/common/useBackgroundServices";

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
    case "meals":
      return "meals";
    case "meals-shopping":
      return "meals-shopping";
    case "meals-day":
      return "meals-day";
    case "meals-method":
      return "meals-method";
    case "meals-onboarding":
      return "meals-onboarding";
    default:
      return null;
  }
}

// The reflow reading area (docs/70). Written against the same contract as the
// screen that mounts it, so the two were built apart and meet here.
const FLOW_PANE: ComponentType<FlowReaderPaneProps> | null = FlowReaderPane;

export default function PhoneApp({
  // The pane, injectable so a smoke test can mount the reader screen against a
  // fake one. Nothing in the app passes it; the line above is where it comes
  // from.
  Pane = FLOW_PANE,
}: {
  Pane?: ComponentType<FlowReaderPaneProps> | null;
} = {}) {
  const [stack, setStack] = useState<NavStack>(INITIAL_STACK);
  // The corner companion, per device (docs/68). The phone keeps its own answer:
  // a reader who put Lumen away here has not put it away on the desk.
  const [lumenShown, setLumenShown] = useState(() =>
    readLumenCornerShown(browserPrefStore(window)),
  );
  // Where it stands. Every conversation on this shell is the whole screen, so
  // any composer that reports itself is one sitting on the bottom edge, and the
  // corner rises above it (lumen/corner-placement.ts) — the briefing's call, the
  // lesson and the lesson's aside alike. On the screens that hold no
  // conversation nothing is measured and the corner keeps the corner.
  const { composerRef: composerSlot, placement: lumen } = useCornerLift(lumenShown, true);
  const toggleLumen = useCallback(() => {
    setLumenShown((shown) => {
      writeLumenCornerShown(browserPrefStore(window), !shown);
      return !shown;
    });
  }, []);
  // The kept articles (docs/21). Fixed to the Brief topic: the phone has no
  // other place to file one from. The one being read is a stack entry.
  // Null until saved-articles.json has been read: "Nothing kept yet" is a claim
  // about a file nobody has opened.
  const [savedArticles, setSavedArticles] = useState<SavedArticle[] | null>(null);
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  // The shelf (docs/70): the topics and the book registry. Null until they have
  // been read — the home card says nothing about a library nobody has listed.
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [entries, setEntries] = useState<Record<string, LibraryEntry>>({});
  // Which book the reader screen is on, and where it was opened from. The stack
  // entry carries what back and the title need; the topic and the path are what
  // leaving the book writes to, and only the shelf knew them.
  const [openedBook, setOpenedBook] = useState<PhoneBookOpen | null>(null);
  const refreshShelf = useCallback(async () => {
    const [list, registry] = await Promise.all([
      listTopics().catch((): Topic[] => []),
      listLibraryEntries().catch((): Record<string, LibraryEntry> => ({})),
    ]);
    setTopics(list);
    setEntries(registry);
  }, []);

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
  // nothing in the shared bootstrap knows about it, so it is read here.
  useEffect(() => {
    void refreshSavedArticles();
  }, [refreshSavedArticles]);

  // Account sync (docs/13). The kept articles are what this shell mostly shows
  // and they arrive over sync, so a pulled saved-articles.json reloads the list.
  // The shelf is the other half, and its route is registered by
  // useBackgroundServices below: topics.json and library.json are what its
  // cards are made of, and a book added on the desk reaches the phone as a pull
  // and nothing else. The two routes overlap on saved-articles.json, which
  // costs one extra read of the shelf's two files.
  // Every other file a pull writes has a route of its own (platform/sync/
  // pull-routes.ts), settings.json included — this shell holds it whole in
  // memory and saves it whole, so a field merged in from another device is
  // undone by the next save unless the shared bootstrap reads the copy back.
  useEffect(
    () =>
      registerPullRoute({
        ...KEPT_ARTICLES_PULL_ROUTE,
        onPulled: () => void refreshSavedArticles(),
      }),
    [refreshSavedArticles],
  );

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const onShelfPulled = useCallback(() => void refreshShelf(), [refreshShelf]);
  // The background services both shells start (useBackgroundServices.ts).
  useBackgroundServices({ form: "phone", settingsRef, onShelfPulled });

  // The Android button, bound only while back has somewhere to go: with nothing
  // to close and nothing to pop it belongs to the system, which leaves the app
  // (see platform/app/back-button.ts).
  // The shelf, whenever the reader is not in a book: what a reading session
  // changes on disk is the position and which file was opened last, and both of
  // them are what the shelf and the home card draw.
  const inReader = base.kind === "reader";
  useEffect(() => {
    if (!inReader) void refreshShelf();
  }, [inReader, refreshShelf]);

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
    // A day carries its date, so it is opened by onOpenMealsDay rather than by
    // naming a destination; nothing asks for it through here.
    if (next === "meals-day") return;
    const kind = next === "vestibule" ? "home" : next;
    setStack((s) => goTo(s, screen(kind)));
  }, []);

  // Into a book. The entry carries the book; the rest of what leaving it needs
  // is held beside the stack.
  const openReader = useCallback((book: PhoneBookOpen) => {
    setOpenedBook(book);
    setStack((s) => push(s, { kind: "reader", bookId: book.bookId, name: book.name }));
  }, []);

  // Into a lesson (docs/70). The first one on this phone is explained before it
  // opens: the tap the reader made was on a book cover, and what comes up is a
  // conversation. The sheet holds the book it was opened on until the reader
  // says go, and this machine remembers that it was said.
  const [lessonIntro, setLessonIntro] = useState<PhoneBookOpen | null>(null);
  const enterLesson = useCallback((book: PhoneBookOpen) => {
    setStack((s) => push(s, { kind: "lesson", ...book }));
  }, []);
  const openLesson = useCallback(
    (book: PhoneBookOpen) => {
      if (device?.lessonIntroSeen) return enterLesson(book);
      setLessonIntro(book);
    },
    [device?.lessonIntroSeen, enterLesson],
  );
  const startLesson = useCallback(() => {
    const book = lessonIntro;
    setLessonIntro(null);
    if (device) applyDevice({ ...device, lessonIntroSeen: true });
    if (book) enterLesson(book);
  }, [applyDevice, device, enterLesson, lessonIntro]);

  // Whether this build can hand a file to another app (platform/app/open-in.ts).
  // Asked once per launch: it is a property of the host, and a control that
  // appeared halfway through a lesson would be a control nobody trusts.
  const [canOpenIn, setCanOpenIn] = useState(false);
  useEffect(() => {
    let live = true;
    void openInAvailable().then((ok) => {
      if (live) setCanOpenIn(ok);
    });
    return () => {
      live = false;
    };
  }, []);
  // The share sheet for one book's PDF. Fails with a line rather than silently:
  // the reader pressed something, and nothing appearing is the one answer that
  // says nothing.
  // The name travels with the file: the library's copy is stored under the
  // book's content hash, and the reader should not meet 64 hex characters in
  // the app they opened it in.
  const handOver = useCallback(
    (bookId: string, name: string) => {
      void (async () => {
        try {
          await openIn(await libraryFilePath(bookId, "pdf"), shareFileName(name, "pdf"));
        } catch (e) {
          console.error("failed to open the file elsewhere", e);
          pushToast("warn", "This file could not be handed to another app.");
        }
      })();
    },
    [pushToast],
  );

  const openSettings = useCallback(() => setStack((s) => push(s, screen("settings"))), []);

  // Where the soul may take the reader (docs/71). The same places the other
  // shell registers, minus the shelf, and all of them through the one navigate
  // above: the stack decides whether arriving somewhere is a push or a back.
  useEffect(
    () => registerPlaces(shellPlaces({ goToScreen: onNavigate }, PHONE_PLACES)),
    [onNavigate],
  );

  return (
    // The backdrop the swipe reveals, and the clip that hides whatever has left
    // the screen. Only ever visible while a gesture or its animation is running.
    <KeyboardShell className="relative h-full overflow-hidden bg-muted-soft">
      {/* p-safe: the notch and the home indicator (viewport-fit=cover). Fixed
          overlays are not covered by it and pad themselves — docs/pitfall/74. */}
      <div ref={surfaceRef} className="flex h-full flex-col bg-background p-safe">
        {/* No shell header: every screen carries its own top bar, and a second
            one above them would cost a phone a line of reading height for
            nothing. */}
        <main className="relative min-h-0 flex-1">
          {/* The chat card table (docs/17's probe cards, the briefing card).
              chat/ reads it from a context, so it never imports the domains that
              fill it, and a shell that leaves this out renders no card at all. */}
          <CardRegistryProvider>
          <ComposerSlotContext.Provider value={composerSlot}>
          <InfoHome
            screen={infoScreenFor(base)}
            onNavigate={onNavigate}
            role={device?.role ?? null}
            configured={configured}
            launchReady={bootstrapped}
            onOpenSettings={openSettings}
            onTopicsChanged={refreshSavedArticles}
            onSay={(line) => pushToast("error", line)}
            onOverlayChange={onOverlayChange}
            // Pull down on the briefing or on an article to open the chat about
            // it. Only those two: home and the kept list have nothing to talk
            // about, and a kept article is still invisible to the AI (docs/21),
            // so a chat over one would not know what it was reading. The gesture
            // is this shell's, so it is this shell that wraps the screen in it.
            wrapScreen={(screen, children) => <PullToAsk {...screen}>{children}</PullToAsk>}
            mealsEnabled={settings.meals}
            // One day of the week is a stack entry like an opened article, so
            // the date rides on it and the back gesture leaves it the same way
            // it leaves anything else.
            mealsDay={base.kind === "meals-day" ? base.date : null}
            onOpenMealsDay={(date) => setStack((s) => push(s, { kind: "meals-day", date }))}
            // Method & sources and a replayed onboarding are opened from more
            // than one screen, so their back is the stack's own.
            onMealsBack={goBack}
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
                continueBook={topics === null ? undefined : continueReading(topics, entries)}
                onContinue={(book) => openReader({ ...book, name: book.title })}
                onOpenLibrary={() => setStack((s) => push(s, screen("library")))}
                settingsAlert={syncReport.alert !== "none"}
                meals={settings.meals}
                onOpenMeals={() => onNavigate("meals")}
                lumenShown={lumenShown}
                onToggleLumen={toggleLumen}
              />
            )}
          />

          {base.kind === "saved" && (
            <SavedList
              articles={savedArticles ?? []}
              onOpen={(article) => setStack((s) => push(s, { kind: "savedArticle", article }))}
              onBack={goBack}
              onChanged={refreshSavedArticles}
              onNotice={pushToast}
            />
          )}

          {base.kind === "savedArticle" && (
            <SavedArticleView article={base.article} backLabel="Saved" onBack={goBack} />
          )}

          {(base.kind === "library" || base.kind === "topic") && (
            <PhoneShelf
              topics={topics}
              topic={
                base.kind === "topic"
                  ? (topics?.find((t) => t.id === base.topicId) ?? null)
                  : null
              }
              entries={entries}
              onOpenTopic={(topicId) => setStack((s) => push(s, { kind: "topic", topicId }))}
              onOpenBook={openReader}
              onOpenLesson={openLesson}
              onBack={goBack}
              onSay={(line) => pushToast("warn", line)}
              onImported={refreshShelf}
              onChanged={refreshShelf}
              onNotice={pushToast}
            />
          )}

          {base.kind === "lesson" && (
            <PhoneLessonScreen
              bookId={base.bookId}
              title={base.name}
              topicId={base.topicId}
              topicName={topics?.find((t) => t.id === base.topicId)?.name ?? ""}
              onBack={goBack}
              onOverlayChange={onOverlayChange}
              onNotice={pushToast}
              {...(canOpenIn ? { onOpenIn: () => handOver(base.bookId, base.name) } : {})}
            />
          )}

          {base.kind === "reader" && openedBook && Pane && (
            <PhoneReader
              // One screen per book: its lesson and its refs belong to the book
              // it was opened on, and leaving the book hangs that lesson up.
              key={openedBook.bookId}
              Pane={Pane}
              bookId={openedBook.bookId}
              name={openedBook.name}
              topicId={openedBook.topicId}
              path={openedBook.path}
              topic={topics?.find((t) => t.id === openedBook.topicId) ?? null}
              settingsRef={settingsRef}
              pushToast={pushToast}
              onOverlayChange={onOverlayChange}
              onBack={goBack}
            />
          )}
          </ComposerSlotContext.Provider>
          </CardRegistryProvider>
        </main>

        <Toast toasts={toasts} onDismiss={dismissToast} />

        {/* The count only. The phone shell has no open-a-file door of its own,
            so the reader goes back to the shelf and finds the translation there. */}
        <TranslateStatus openDocId={() => null} />

        {/* Said once per phone, over the shelf the tap came from (docs/70). The
            second button is the same door the lesson's top bar has, offered
            before the lesson to the reader who wanted the pages themselves. */}
        <PhoneLessonIntroSheet
          open={lessonIntro !== null}
          onOpenChange={(open) => {
            if (!open) setLessonIntro(null);
          }}
          onStart={startLesson}
          {...(canOpenIn && lessonIntro
            ? { onOpenIn: () => handOver(lessonIntro.bookId, lessonIntro.name) }
            : {})}
        />

        {showSettings && (
          <SettingsDialog
            settings={settings}
            onSettingsChange={applySettings}
            device={device}
            onDeviceChange={applyDevice}
            onClose={goBack}
          />
        )}
      </div>

      {/* Lumen, bottom right, on every screen this shell draws (docs/68). A card
          born over a book still shows here and can still be pressed away; what
          it cannot do is jump, because this shell has no reader to jump into
          (lumen/box-jump.ts). */}
      <LumenCorner
        shell="phone"
        shown={lumen.shown}
        liftPx={lumen.liftPx}
        // The lesson's replies are read and held where the lifted corner
        // would stand, so Lumen stands down for that screen (docs/74).
        stoodDown={base.kind === "lesson"}
        targets={{
          goToDoor: () => onNavigate("vestibule"),
          goToBriefing: () => onNavigate("briefing"),
          goToMeals: () => onNavigate("meals"),
        }}
      />
    </KeyboardShell>
  );
}
