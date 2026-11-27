// The phone shell (docs/22), beside App.tsx: home, the shelf, the EPUB reader
// and the paper lesson, meals, the companion, and settings. This file owns
// where the reader is — a navigation stack (nav-stack.ts) whose floor is home —
// plus settings and sync.
//
// Back has one definition, `goBack`, and three things reach it: the top bar
// button on every screen, the left-edge swipe, and the Android system button.

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { bindSystemBack } from "./platform/app/back-button";
import { listTopics, onFiledElsewhere, type Topic } from "./platform/app/topics";
import { listLibraryEntries, type LibraryEntry } from "./platform/app/library";
import {
  libraryFilePath,
  openIn,
  openInAvailable,
  shareFileName,
} from "./platform/app/open-in";
import FlowReaderPane from "./reading/epub/flow/FlowReaderPane";
import type { FlowReaderPaneProps } from "./reading/epub/flow/flow-contract";
import { registerPlaces } from "./desk";
import { PHONE_PLACES, shellPlaces } from "./ui/components/base/places";
import { hiddenByExperiments, reachableScreen } from "./ui/components/base/shell-nav";
import { CardRegistryProvider } from "./ui/components/CardRegistryProvider";
import type { HomeScreen } from "./ui/components/base/shell-nav";
import { useMealsHost } from "./ui/components/meals/use-meals-host";
import { MealsHost } from "./ui/components/meals/MealsHost";
import PhoneHome from "./ui/components/phone/PhoneHome";
import { CompanionCorner } from "./ui/components/companion/CompanionCorner";
import { useCornerLift } from "./ui/components/companion/use-corner-lift";
import { ComposerSlotContext } from "./ui/components/chat/call/composer-slot";
import { toggleCompanionShown, useCompanionShown } from "./ui/components/companion/use-companion-shown";
import { useExperimentGates } from "./ui/components/common/use-experiment";
import { PullToAsk } from "./ui/components/phone/gesture/PullToAsk";
import PhoneReader from "./ui/components/phone/reader/PhoneReader";
import PhoneLessonScreen from "./ui/components/phone/lesson/PhoneLessonScreen";
import PhoneLessonIntroSheet from "./ui/components/phone/lesson/PhoneLessonIntroSheet";
import PhoneShelf, { type PhoneBookOpen } from "./ui/components/phone/PhoneShelf";
import { continueReading, conversationDoor } from "./ui/components/phone/shelf-list";
import {
  back,
  backIsAvailable,
  baseScreen,
  goTo,
  INITIAL_STACK,
  openPrep,
  push,
  resolveBack,
  screen,
  top,
  type NavStack,
  type PhoneScreen,
} from "./ui/components/phone/nav-stack";
import { useEdgeBack } from "./ui/components/phone/gesture/useEdgeBack";
import SettingsDialog from "./ui/components/SettingsDialog";
import Toast, { useToasts } from "./ui/components/common/Toast";
import { useT } from "./i18n";
import { alreadyInLine } from "./ui/components/shelf/move-to";
import TranslateStatus from "./ui/components/reader/TranslateStatus";
import { useShellBootstrap } from "./ui/components/common/useShellBootstrap";
import { KeyboardShell } from "./ui/components/common/KeyboardShell";
import { useBackgroundServices } from "./ui/components/common/useBackgroundServices";
import { startDistillSweeps } from "./memory";
import { stallWatches } from "./legion/durable/stall";

// The home screen a stack entry is, for MealsHost, or null on the ones that are
// none of its business.
function homeScreenFor(base: PhoneScreen): HomeScreen | null {
  switch (base.kind) {
    case "home":
      return "vestibule";
    case "meals":
      return "meals";
    case "meals-shopping":
      return "meals-shopping";
    case "meals-day":
      return "meals-day";
    case "meals-recipe":
      return "meals-recipe";
    case "meals-prep":
      return "meals-prep";
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
  const t = useT();
  const [stack, setStack] = useState<NavStack>(INITIAL_STACK);
  // The corner companion, per device (docs/68). The phone keeps its own answer:
  // a reader who put the companion away here has not put it away on the desk.
  // Settings › Experiments (platform/experiments): which of meals, Intel's
  // Briefs and studies, and the companion this device draws. Off hides the
  // entries and the screens; nothing behind them is stopped.
  const gates = useExperimentGates();
  const companionShown = useCompanionShown() && gates.companion;
  // Where it stands. Every conversation on this shell is the whole screen, so
  // any composer that reports itself is one sitting on the bottom edge, and the
  // corner rises above it (companion/corner-placement.ts) — the meals call, the
  // lesson and the lesson's aside alike. On the screens that hold no
  // conversation nothing is measured and the corner keeps the corner.
  const { composerRef: composerSlot, placement: companion } = useCornerLift(companionShown, true);
  const toggleCompanion = toggleCompanionShown;
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

  // A call drawn over the screens (the meals call). It is not a stack entry, so
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

    syncReport,
  } = useShellBootstrap({ settingsOpen: showSettings, pushToast });
  // The meals line (docs/73) is this device's Meals experiment
  // (platform/experiments). settings.meals is no longer read.
  const mealsOn = gates.meals;
  const shownRef = useRef({ meals: mealsOn });
  shownRef.current = { meals: mealsOn };
  // A screen whose line was switched off under the settings sheet goes home.
  useEffect(() => {
    if (hiddenByExperiments(base.kind, { meals: mealsOn })) setStack(INITIAL_STACK);
  }, [base.kind, mealsOn]);

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

  // A book is on one topic, so an add of one another topic lists left it there
  // (platform/app/topics.ts addFile).
  useEffect(
    () => onFiledElsewhere((found) => pushToast("info", alreadyInLine(found.topic.name))),
    [pushToast, t],
  );

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const onShelfPulled = useCallback(() => void refreshShelf(), [refreshShelf]);
  // The background services both shells start (useBackgroundServices.ts).
  useBackgroundServices({ form: "phone", settingsRef, onShelfPulled });

  // Pay down whatever the observations still owe, as the desktop shell does, but
  // only while the phone is in front (memory/live/sweeps.ts sweepCadence). The
  // phone's conversations do not say which thread is answering, so any turn
  // streaming keeps the sweep off every thread.
  useEffect(() => startDistillSweeps(() => stallWatches().activity().live > 0, "phone"), []);

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

  // A screen navigates by naming a destination. goTo unwinds to a screen
  // already on the stack, so those stay backs instead of stacking a second copy.
  // "library" cannot arrive: the phone home screen has no way there.
  const onNavigate = useCallback((next: HomeScreen) => {
    // A day carries its date, so it is opened by onOpenMealsDay rather than by
    // naming a destination; nothing asks for it through here.
    // A line whose experiment is off lands on home (platform/experiments).
    const reached = reachableScreen(next, shownRef.current);
    if (reached === "meals-day" || reached === "meals-recipe" || reached === "meals-prep") return;
    const kind = reached === "vestibule" ? "home" : reached;
    setStack((s) => goTo(s, screen(kind)));
  }, []);

  // The meals line's state, held by the shell rather than by its screens so the
  // prep run, its call and the conversation outlive the screen being shown.
  const mealsHost = useMealsHost({
    enabled: mealsOn,
    screen: homeScreenFor(base),
    onNavigate,
    onOpenMealsPrep: (session) => setStack((s) => openPrep(s, session)),
    onOverlayChange,
  });

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
          pushToast("warn", t("shell.toast.cantShareFile"));
        }
      })();
    },
    [pushToast, t],
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
          {/* The chat card table.
              chat/ reads it from a context, so it never imports the domains that
              fill it, and a shell that leaves this out renders no card at all. */}
          <CardRegistryProvider>
          <ComposerSlotContext.Provider value={composerSlot}>
          {base.kind === "home" && (
            <div className="absolute inset-0 overflow-y-auto bg-background">
              <PhoneHome
                onOpenSettings={openSettings}
                topics={topics}
                continueBook={topics === null ? undefined : continueReading(topics, entries)}
                onContinue={(book) => openReader({ ...book, name: book.title })}
                // Through the topic list, so the topic's back lands where its label says.
                onOpenTopic={(topicId) =>
                  setStack((s) => push(push(s, screen("library")), { kind: "topic", topicId }))
                }
                onOpenLibrary={() => setStack((s) => push(s, screen("library")))}
                settingsAlert={syncReport.alert !== "none"}
                meals={mealsOn}
                onOpenMeals={() => onNavigate("meals")}
                mealsTile={mealsHost.tile}
                // Tapped before info-meals.json is read: the Meals page, which holds until it is.
                onMealsTile={() => mealsHost.runAction(mealsHost.tile?.action ?? { kind: "meals" })}
                companionShown={companionShown}
                onToggleCompanion={toggleCompanion}
                companionAvailable={gates.companion}
              />
            </div>
          )}

          {homeScreenFor(base) !== null && (
            <MealsHost
              host={mealsHost}
              screen={homeScreenFor(base)!}
              onNavigate={onNavigate}
              enabled={mealsOn}
              // One day of the week is a stack entry like an opened article, so
              // the date rides on it and the back gesture leaves it the same way
              // it leaves anything else.
              mealsDay={base.kind === "meals-day" || base.kind === "meals-recipe" ? base.date : null}
              onOpenMealsDay={(date) => setStack((s) => push(s, { kind: "meals-day", date }))}
              // A meal's recipe is pushed over its day, so the back gesture
              // lands on the day where the reader left it.
              mealsRecipe={base.kind === "meals-recipe" ? base.meal : null}
              onOpenMealsRecipe={(date, meal) => setStack((s) => push(s, { kind: "meals-recipe", date, meal }))}
              // The batch cook is an entry over the Meals page and carries its
              // session, so back from it is the Meals page wherever it was opened.
              mealsPrep={base.kind === "meals-prep" ? base.session : null}
              // Method & sources and a replayed onboarding are opened from more
              // than one screen, so their back is the stack's own.
              onMealsBack={goBack}
              wrapScreen={(screen, children) => <PullToAsk {...screen}>{children}</PullToAsk>}
              // No corner cards over the chat: on the phone it is a screen of the stack.
              pipCards={false}
              onTopicsChanged={() => void refreshShelf()}
            />
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
              {...(openedBook.threadId ? { threadId: openedBook.threadId } : {})}
              onSwitchBook={(bookId, name) => {
                setOpenedBook({ bookId, name, topicId: openedBook.topicId, path: "" });
                setStack((s) => [...s.slice(0, -1), { kind: "reader", bookId, name }]);
              }}
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

      {/* The companion, bottom right, on every screen this shell draws (docs/68). A card
          born over a book opens that book's conversation: a paper's lesson, an
          EPUB's thread over its page (companion/box-jump.ts). One born in the
          coach or a retell cannot jump here and says so. Typing to the companion opens a chat of its own here,
          which draws cards like every other chat, so it gets the card table
          too. */}
      {gates.companion && (
      <CardRegistryProvider>
      <CompanionCorner
        shell="phone"
        shown={companion.shown}
        liftPx={companion.liftPx}
        // The lesson's replies are read and held where the lifted corner
        // would stand, so the companion stands down for that screen (docs/74).
        stoodDown={base.kind === "lesson"}
        targets={{
          goToMeals: () => onNavigate("meals"),
          // A book's conversation: a paper's lesson, or an EPUB's thread over its page.
          openBookConversation: (bookId, threadId) => {
            for (const topic of topics ?? []) {
              const file = topic.files.find((one) => one.hash === bookId);
              if (!file) continue;
              const entry = entries[bookId];
              const book = { bookId, name: entry?.title || file.name, topicId: topic.id, path: file.path };
              if (conversationDoor(entry?.format) === "lesson") openLesson(book);
              else openReader({ ...book, threadId });
              return;
            }
          },
          // An intake card's 「打开阅读」 (companion/IntakeCard.tsx).
          openDocument: (doc) =>
            openReader({ bookId: doc.hash, name: doc.title, topicId: doc.topicId, path: doc.path }),
        }}
      />
      </CardRegistryProvider>
      )}
    </KeyboardShell>
  );
}
