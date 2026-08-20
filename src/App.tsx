import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  isPageMark,
  type Annotation,
  type AnnotationPopupParams,
  type MarkPen,
  type ViewInstance,
  type ViewState,
  type ViewStats,
} from "./platform/app/reader-contract";
import { hashPath } from "./platform/app/storage";
import { importBook, repairLibraryNames } from "./platform/app/library";
import { migrateBookLive } from "./platform/app/migrate";
import { documentShape, type Fulltext } from "./fulltext";
import Sidebar, { type SidebarTab } from "./ui/components/reader/Sidebar";
import {
  ANNOTATION_COLORS,
  deleteAnnotations,
  saveAnnotations,
} from "./platform/app/annotations";
import {
  addFileToTopic,
  listTopics,
  markOpened,
  mostRecentlyOpened,
  repairTopicPaths,
  setFileHash,
  type FileRef,
  type Topic,
} from "./platform/app/topics";
import {
  createAsideThread,
  createThread,
  getThread,
  type Thread,
  type ThreadMessage,
} from "./platform/app/threads";
import { initSync } from "./platform/sync";
import { registerPullRoute } from "./platform/sync/pull-routes";
import { compressImage, compressImageData } from "./ai/image-utils";
import { readClipboardImage } from "./platform/app/clipboard";
import { isTauri } from "./platform/app/host";
import { DEFAULT_SETTINGS, type Settings } from "./platform/app/settings";
import { buildGlossary } from "./ai/voice";
import { modelSupportsImages, type ProviderId } from "./ai/aiClient";
import { locateQuote, prepKind, type Citation } from "./reading/prep";
import { usePrep } from "./reading/prep/papers/use-prep";
import { usePrepTrigger } from "./reading/session/use-prep-trigger";
import { purgeLegacyChapterNotes } from "./reading/prep/chapters/purge";
import { useChapterSpine } from "./reading/prep/chapters/use-chapter-spine";
import InfoHome, { type HomeScreen } from "./ui/components/info/InfoHome";
import { startDistillSweeps, toDistillAnnotations, type DistillAnnotation } from "./observation";
import { logEvent } from "./platform/app/events";
import { prewarmPdfiumEngine } from "./reading/engine/engine-singleton";
import EmbedReaderPane from "./reading/engine/EmbedReaderPane";
import { openFailureText } from "./reading/engine/open-failure";
import {
  CitationContext,
  FigureContext,
  PrepSlugContext,
  type FigureHost,
} from "./ui/components/markdown/Markdown";
import {
  findFigureById,
  renderFigure,
  type Figure,
  type FiguresIndex,
} from "./reading/figures";
import PrepPanel from "./ui/components/reader/PrepPanel";
import ReaderTopBar from "./ui/components/reader/ReaderTopBar";
import { useReaderZoomKeys } from "./ui/components/reader/reader-zoom-keys";
import AnnotationPopup from "./ui/components/reader/AnnotationPopup";
import CallBubble from "./ui/components/chat/CallBubble";
import CallView from "./ui/components/chat/CallView";
import type { ChatMarkHost } from "./ui/components/chat/chat";
import ReadingPipCard from "./ui/components/chat/ReadingPipCard";
import ChatPipCard from "./ui/components/chat/ChatPipCard";
import SettingsView from "./ui/components/SettingsView";
import {
  levelGate,
  toolInCall,
  type CallRow,
  type CallState,
  type CallView as CallViewMode,
} from "./reading/call-state";
import { asideAnchorAt, asideFraming, asideReturn } from "./reading/aside";
import { markExcerpt } from "./reading/reopen";
import {
  buildChatMark,
  chatMarkWords,
  markDoorThread,
  markOpenAction,
  orderTraceMarks,
  traceSelectAction,
  type ChatMarkDraw,
} from "./reading/chat-marks";
import { asideIntents, bookTextNotice, openingIntents, type ReadingIntent } from "./reading/intents";
import { chapterAtPage } from "./reading/chapters";
import { resolveBookThread } from "./reading/session/book-thread";
import { closeBook } from "./reading/session/close-book";
import { useCall } from "./reading/session/use-call";
import { openBook } from "./reading/session/open-book";
import { resolveBookSource } from "./reading/session/open-file";
import type { ReaderShell } from "./reading/session/shell";
import { SHELF_PULL_ROUTE } from "./reading/pull-routes";
import { keepReadingPosition } from "./reading/reading-position";
import { Button } from "./ui/components/ui/button";
import { OVERLAY_Z } from "./ui/components/ui/overlay";
import LibraryScreen from "./ui/components/library/LibraryScreen";
import Toast, { useToasts } from "./ui/components/common/Toast";
import SettingsButton from "./ui/components/common/SettingsButton";
import { useShellBootstrap } from "./ui/components/common/useShellBootstrap";
import type { Annotation as PopupAnnotation, ToolType } from "./ui/components/reader/types";
import type { PendingImage } from "./ui/components/chat/types";
import {
  cardRow,
  chatGlance,
  nextCardId,
  rehydrateMessage,
  type CardAction,
  type ChatPart,
} from "./ui/components/chat/chatParts";
import { CardRegistryProvider } from "./ui/components/CardRegistryProvider";
import { refreshInfoCollector } from "./info/briefing/live";

// The AI pen maps to the engine's underline tool in a fixed purple (the palette's
// Purple). Owning this one color for the AI pen is a v1 implementation
// convenience, not a semantic in the color palette; the host identifies AI-pen
// strokes by the active tool, not the color.
const AI_PEN_COLOR = "#a28ae5";
// Cap on images attached to one chat turn (docs/03: paste screenshots to ask).
// Per conversation, like the staging list itself.
const MAX_PENDING_IMAGES = 3;
interface PopupState {
  annotation: Annotation;
  anchor: { x: number; y: number };
}

// Display message. Unlike the persisted ThreadMessage (which stores images as
// on-disk filenames), the display form carries the image bytes as base64 so a
// bubble can render them directly; App loads them from disk on thread open.
// Everything the session itself reads or writes is in CallRow; what is left here
// is the render layer's own (chatParts.ts), which the domain never touches.
interface CallMessage extends CallRow {
  // The durable parts of the row (chatParts.ts). Present on rows that carry a
  // card — a recorded rehearsal decision — and absent on plain prose, which
  // renders from `text`.
  parts?: ChatPart[];
}

// Persisted thread messages -> display messages. Image bytes are loaded
// separately (hydrateThreadImages), so images start absent here. Stored parts
// come back as render parts (rehydrateMessage), so a rehearsal decision card is
// still there when the conversation is reopened days later.
// The part of a thread record that says whether it is a side conversation and
// what of. Narrow, so a conversation being created can be framed before it has a
// record of its own.
type AsideThread = Pick<Thread, "annotationId" | "book" | "parentThreadId" | "asideAnchor">;

function toDisplayMessages(msgs: ThreadMessage[]): CallMessage[] {
  return msgs.map(rehydrateMessage);
}

export default function App() {
  // The reader pane's DOM container: anchor fallbacks measure against it, and
  // its capture-phase pointer handlers implement pen-lift tracking + the
  // touch-the-book dismissal (the engine lives in the same document now).
  const readerPaneRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ViewInstance | null>(null);
  // Whether a transient AI-cited-quote overlay is showing, so Escape can dismiss
  // it before it falls through to closing the call.
  const [quoteHlActive, setQuoteHlActive] = useState(false);
  // The open book's id: the content hash its annotations, threads, reading
  // position, prep notes and figure crops are all keyed by. Null in the library.
  const bookIdRef = useRef<string | null>(null);
  // Its file name, for the handlers that have to name it in a sentence and must
  // stay stable across renders (the reader pane is memoized on prop identity).
  const bookNameRef = useRef("");

  // Annotations for the open document, keyed by id for merge-on-save.
  const annsRef = useRef<Map<string, Annotation>>(new Map());
  // Whether the active pen is the AI pen (host-owned; not inferred from color).
  const aiPenRef = useRef(false);
  // Last pen-lift position over the reader pane (viewport coordinates) — the
  // AI-pen bubble anchor, since drawing a pen stroke yields no popup coordinates.
  const penUpRef = useRef<{ x: number; y: number } | null>(null);
  // The current book's full text, extracted fire-and-forget on open. A call's
  // context assembly awaits this so the AI can see the page even if extraction
  // is still finishing; null once resolved when the book has no text layer.
  const currentFulltextRef = useRef<Promise<Fulltext | null> | null>(null);
  // The current book's figure index (M9), extracted fire-and-forget on open like
  // the full text. The ref is awaited during context assembly; `figures` mirrors
  // the resolved list for the inline-card host.
  const currentFiguresRef = useRef<Promise<FiguresIndex | null> | null>(null);
  // The open book's bytes, kept for figure rasterization (M9). renderFigure
  // copies before handing to pdf.js, so sharing this reference is safe.
  const bufferRef = useRef<ArrayBuffer | null>(null);
  // Mirror of the resolved figure list for the stable onCitation callback.
  const figuresRef = useRef<Figure[]>([]);
  // Refs the session and the two panels read at call time, so their callbacks
  // keep a stable identity (avoids dependency churn).
  const settingsRef = useRef<Settings>({ ...DEFAULT_SETTINGS });
  const ctxRef = useRef<{
    topicId: string | null;
    topicName: string;
    fileName: string;
    pageLabel: string | null;
    pageIndex: number | null;
    files: { path: string; name: string; hash?: string }[];
  }>({
    topicId: null,
    topicName: "",
    fileName: "",
    pageLabel: null,
    pageIndex: null,
    files: [],
  });
  // Event-log instrumentation (M8). Dwell: the page being read and when it was
  // entered. lastCallThread: the thread a call-start was last logged for.
  const pageDwellRef = useRef<{ page: number; since: number } | null>(null);
  const lastCallThreadRef = useRef<string | null>(null);
  // Guards the one-time content-hash backfill so StrictMode's double effect run
  // doesn't start it twice.
  const migrationRan = useRef(false);

  // Null until the library has been read. Not [] — an empty array is a shelf
  // with nothing on it, which is what the vestibule would announce to a user who
  // has twenty books, a moment before their most recent one appears in its place.
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);

  // The launch layer in front of the library, only meaningful when not in the
  // reader. InfoHome renders every screen but the library.
  const [homeScreen, setHomeScreen] = useState<HomeScreen>("vestibule");

  // The open book: bytes + saved state for EmbedReaderPane; null in the library.
  const [embedDoc, setEmbedDoc] = useState<{
    bookId: string;
    name: string;
    buffer: ArrayBuffer;
    annotations: Annotation[];
    viewState: ViewState | null;
  } | null>(null);

  const [stats, setStats] = useState<ViewStats | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [pickedTool, setPickedTool] = useState<ToolType>("none");
  const [penColor, setPenColor] = useState(ANNOTATION_COLORS[0].color);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [viewReady, setViewReady] = useState(false);
  const [traceAnns, setTraceAnns] = useState<Annotation[]>([]);
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);
  // The panel is an overlay drawer, closed by default on every surface (docs:
  // iPad adaptation). The open/closed choice persists for the session (App stays
  // mounted across book open/close) and resets to closed on restart (reload).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("traces");
  // The current book's extracted text (M6 AI context) and outline (Sidebar).
  // Set from openInReader once ensureFulltext resolves; see the comment there.
  const [fulltext, setFulltext] = useState<Fulltext | null>(null);
  const [fulltextPending, setFulltextPending] = useState(false);
  // Resolved figure list for the current book (M9), feeding the inline [fig:N]
  // card host and empty until extraction finishes.
  const [figures, setFigures] = useState<Figure[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  // Failure messages (save/load/network errors) live here, not in `status` —
  // `status` is reserved for transient reader progress ("Rendering…").
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  // Everything both shells start up the same way: the two settings files, the
  // provider list, the sync-health verdict, and the store error hooks.
  const {
    settings,
    applySettings,
    device,
    applyDevice,
    configured,
    ready: bootstrapped,
    syncReport,
  } = useShellBootstrap({ settingsOpen: showSettings, pushToast });
  const fingerDraw = !!device?.fingerDraw;


  // Prewarm the PDFium engine so the wasm is compiled before the first book
  // open, not on its critical path.
  useEffect(() => {
    prewarmPdfiumEngine();
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    ctxRef.current = {
      topicId: activeTopic?.id ?? null,
      topicName: activeTopic?.name ?? "",
      fileName: title ?? "",
      pageLabel: stats?.pageLabel ?? null,
      pageIndex: stats?.pageIndex ?? null,
      files: activeTopic?.files.map((f) => ({ path: f.path, name: f.name, hash: f.hash })) ?? [],
    };
  });

  // Lesson prep (docs/09): the panel's state and every callback that serves it.
  // Called here so its effect — the scheduler following the reader — keeps
  // firing among the shell's own, and it reads the open book through the
  // shell's refs.
  const {
    snapshot: prepSnap,
    panel: prepPanelProps,
    pipelineRef,
    progress: paperPrepProgress,
    start: startPaperPrep,
    setSelectedSlug: setSelectedPrepSlug,
    reset: resetPrep,
    resume: resumePrep,
  } = usePrep({
    stats,
    bookIdRef,
    ctxRef,
    currentFulltextRef,
    pushToast,
  });

  // Page-navigation events, with the dwell time on the page being left. The
  // ref makes this idempotent under StrictMode's double effect runs.
  useEffect(() => {
    if (!stats) return;
    const page = stats.pageIndex + 1;
    const prev = pageDwellRef.current;
    if (prev?.page === page) return;
    const now = Date.now();
    const topicId = ctxRef.current.topicId;
    if (prev && topicId) {
      logEvent(topicId, "page-nav", { from: prev.page, to: page, dwellMs: now - prev.since });
    }
    pageDwellRef.current = { page, since: now };
  }, [stats]);

  // What this machine does about collecting, whenever the answer changes — and
  // once when device.json first lands, which is how a collector starts at all
  // (docs/36). A reader falls straight through to giving up its claim.
  const deviceRole = device?.role ?? null;
  const backgroundCollect = device?.backgroundCollect ?? null;
  useEffect(() => {
    if (deviceRole === null) return;
    refreshInfoCollector();
  }, [deviceRole, backgroundCollect]);

  const activeTopic = useMemo(
    () => topics?.find((t) => t.id === activeTopicId) ?? null,
    [topics, activeTopicId],
  );

  // Voice-input enrichment for the chat composer (docs/15): the STT cleanup pass
  // anchors on the current book's title + outline as a glossary. The mic itself
  // and its cleanup model are the composer's own defaults.
  const callVoice = useMemo(
    () => ({ glossary: buildGlossary({ title, outline: fulltext?.outline }) }),
    [title, fulltext],
  );

  const refreshTopics = useCallback(async () => {
    setTopics(await listTopics());
  }, []);

  useEffect(() => {
    // A read that failed still settles the shelf: the vestibule holds a
    // placeholder until this answers, and a placeholder waiting on a read that
    // already gave up never goes away.
    refreshTopics().catch(() => setTopics([]));
  }, [refreshTopics]);

  // One-time content-hash backfill for existing topic files (docs/13, M-sync-1):
  // import each into the library, give it a book id, and move its legacy
  // path-hash-keyed data under that id. Runs once, in the background, and
  // sequentially — books can be hundreds of MB, so never read several at once.
  // Idempotent: a file that already has a book id is skipped.
  useEffect(() => {
    if (migrationRan.current) return;
    migrationRan.current = true;
    void (async () => {
      // Names an iOS import left percent-encoded (docs/pitfall/106). Runs first
      // so the backfill below reads the repaired paths, and writes nothing when
      // there is nothing encoded, so it costs no sync revision.
      let changed = await Promise.all([repairTopicPaths(), repairLibraryNames()])
        .then((wrote) => wrote.some(Boolean))
        .catch((e) => {
          console.warn("name repair skipped", e);
          return false;
        });
      const all = await listTopics().catch((): Topic[] => []);
      for (const t of all) {
        for (const f of t.files) {
          if (f.hash) continue;
          try {
            const bytes = await readFile(f.path);
            const entry = await importBook(bytes, f.path);
            await migrateBookLive(hashPath(f.path), entry.hash);
            await setFileHash(t.id, f.path, entry.hash);
            changed = true;
          } catch (e) {
            console.warn("library migration skipped a file", f.path, e);
          }
        }
      }
      if (changed) await refreshTopics().catch(() => {});
    })();
  }, [refreshTopics]);

  // Account sync (docs/13): start the engine if the user is signed in with
  // auto-sync on, and redraw the shelf when a pull rewrites what it is made of.
  // Everything else a pull touches has a route of its own (platform/sync/
  // pull-routes.ts): the per-book caches are platform's, settings.json is the
  // shared bootstrap's, and the briefing is the info screen's.
  useEffect(() => {
    // Once, on the way up: the chapter notes written before this was a
    // chapter-spine pass are deleted from here and queued for deletion from
    // Drive. After initSync, so the queue is written to the state file that was
    // just read rather than to the placeholder it replaced.
    void initSync("desktop")
      .catch((e) => console.warn("sync init failed", e))
      .finally(() => void purgeLegacyChapterNotes());
    return registerPullRoute({
      ...SHELF_PULL_ROUTE,
      onPulled: () => {
        refreshTopics().catch(() => {});
      },
    });
  }, [refreshTopics]);

  // Whether a finger may mark the page. Applied alongside the tool, and again
  // whenever the setting changes, so the reader never routes a finger by a stale
  // copy of it.
  useEffect(() => {
    if (!viewReady) return;
    viewRef.current?.setFingerDraw(fingerDraw);
  }, [fingerDraw, viewReady]);

  // The reader moved. The debounce, the flush on the way out and the failure
  // that must not be silent (pitfall 09) are all reading-position.ts's.
  const persist = useCallback((state: ViewState) => {
    const bookId = bookIdRef.current;
    if (!bookId) return;
    keepReadingPosition(bookId, state);
  }, []);

  // Page marks first, classroom marks after (reading/chat-marks.ts).
  const syncTraceList = useCallback(() => {
    setTraceAnns(orderTraceMarks([...annsRef.current.values()]));
  }, []);

  const persistAnnotations = useCallback(() => {
    const bookId = bookIdRef.current;
    if (bookId) saveAnnotations(bookId, [...annsRef.current.values()]);
  }, []);

  const removeAnnotation = useCallback(
    (id: string) => {
      viewRef.current?.unsetAnnotations([id]);
      annsRef.current.delete(id);
      const bookId = bookIdRef.current;
      if (bookId) deleteAnnotations(bookId, [id]);
      syncTraceList();
      setPopup(null);
    },
    [syncTraceList],
  );

  // The open book's marks for distillation's silent-marks input (docs/02 part 2):
  // id, page, selected text, note, and creation time (from the engine's ISO
  // dateCreated) so the "since last distillation" filter can work.
  const distillAnnotations = useCallback((): DistillAnnotation[] => {
    return toDistillAnnotations([...annsRef.current.values()]);
  }, []);

  // How a thread opens as a call when it is a side conversation (docs/03): the
  // way back and the span it was opened on. Undefined for every other thread,
  // which spreads into the call as nothing at all. A drawn aside's span is its
  // mark's text, which lives on the annotation and not on the record, so it is
  // read here.
  //
  // `parentView` is the view the conversation it came off is in, where that is
  // known — drawing a mark mid-lesson knows it. Reopening one from its chip or
  // from its mark days later does not, and the default puts the reader back in
  // the full window.
  const asideFramingFor = useCallback(
    (thread: AsideThread | undefined, parentView?: CallViewMode): Pick<CallState<CallMessage>, "aside"> => {
      if (!thread) return {};
      const framing = asideFraming(thread, markExcerpt(annsRef.current.get(thread.annotationId)));
      return framing ? { aside: { ...framing, ...(parentView ? { parentView } : {}) } } : {};
    },
    [],
  );

  // The conversation about the book (docs/03): the open call, the turns running
  // on its threads, the images staged for its next send, and every way in and
  // out of it. Two shapes stay this file's — a chat row, whose parts are the
  // render layer's protocol, and a staged image — so the session is handed the
  // four one-line constructors below instead of the types.
  // The opening chips currently on screen. Kept in a ref so the send path can
  // tell a chip press from typed text: IntentChips sends the intent's message
  // down the ordinary send path, and the chapter chip has to park the
  // conversation on its chapter before that message goes (docs/09).
  const intentsRef = useRef<readonly ReadingIntent[]>([]);
  // Reopening a side conversation from its receipt chip. Held in a ref for the
  // same reason: the card dispatcher is a prop of both chat surfaces and is
  // written above the callback it reaches, so reading it late keeps its identity
  // stable and its declaration where it belongs.
  const openAsideThreadRef = useRef<(threadId: string) => void>(() => {});
  const {
    call,
    captureHangup,
    close: closeCall,
    current: currentCall,
    deleteOpenThread,
    discardStagedImages,
    dismissOnPaneTouch,
    dropThread,
    endBookTurns,
    hangUp: endCall,
    imageHint,
    isAnswering,
    noteImageHint,
    openChatAside,
    openThread: openThreadCall,
    reopenThread: reopenThreadCall,
    pendingImages,
    removePendingImage,
    retry: retryCall,
    returnFromAside,
    send: sendCallMessage,
    showChat: showChatMain,
    showReading: swapToReading,
    stageImage,
    stepDiagram,
    stop: stopTurn,
    chapters: bookChapters,
    focusChapter,
    setFocusChapter,
  } = useCall<CallMessage, PendingImage>({
    annsRef,
    bookIdRef,
    bufferRef,
    ctxRef,
    currentFiguresRef,
    currentFulltextRef,
    distillAnnotations,
    pipelineRef,
    pushToast,
    removeMark: removeAnnotation,
    settingsRef,
    toDisplay: toDisplayMessages,
    newRow: (row) => row,
    // The card channel the drawing tools write through (docs/40). Card parts are
    // this layer's, so the session is handed the three operations rather than
    // the type — the same split as newRow above.
    cards: {
      id: nextCardId,
      row: (cardId, card, ts) => cardRow(cardId, card, ts),
      write: (row, cardId, card) => ({
        ...row,
        parts: (row.parts ?? []).map((p) =>
          p.type === "card" && p.id === cardId ? { ...p, card } : p,
        ),
      }),
    },
    maxImages: MAX_PENDING_IMAGES,
    imageLimitHint: `You can attach up to ${MAX_PENDING_IMAGES} images.`,
    loadingImage: (id) => ({ id, status: "loading" }),
    readyImage: (id, image) => ({ id, status: "ready", data: image.data, mediaType: image.mediaType }),
    sendableImages: (staged) =>
      staged.some((p) => p.status === "loading")
        ? null
        : staged.flatMap((p) => (p.status === "ready" ? [{ data: p.data, mediaType: p.mediaType }] : [])),
  });

  // The Back out of a side conversation and the release of the blackboard are
  // the same question: is the room this one came out of still here
  // (asideReturnable, below). One answer, so the two cannot both be withheld.
  const parentThreadThere = useCallback(
    (parentThreadId: string) => asideReturnable(bookIdRef.current, parentThreadId),
    [],
  );

  // Which of the two controls that open a level are live (docs/03), and the pen
  // the rack acts with once the dim one is taken out of it. Both read the open
  // call, so they sit below it and everything about the tool follows.
  const gate = levelGate(call, parentThreadThere);
  const toolType = toolInCall(pickedTool, call);

  // Apply the tool once the view is initialized (setTool before the pdf viewer
  // is ready throws — PDFViewerApplication null, pitfall 11). The AI pen is the
  // underline tool in a fixed purple.
  useEffect(() => {
    aiPenRef.current = toolType === "ai";
    if (!viewReady) return;
    const tool =
      toolType === "none"
        ? { type: "pointer" as const }
        : toolType === "navlock"
          ? { type: "navlock" as const }
          : toolType === "ai"
            ? { type: "underline" as const, color: AI_PEN_COLOR }
            : { type: toolType, color: penColor };
    viewRef.current?.setTool(tool);
  }, [toolType, penColor, viewReady]);

  // Everything a chat surface sends goes through here, so that pressing a chip
  // can do the one thing typing its words cannot: park the conversation on the
  // chapter the chip named (docs/09). The chips are matched by their message
  // text, which is what IntentChips passes back.
  const sendFromChat = useCallback(
    (text: string) => {
      const picked = intentsRef.current.find((i) => i.message === text);
      if (picked?.focusChapter !== undefined) setFocusChapter(picked.focusChapter);
      sendCallMessage(text);
    },
    [sendCallMessage, setFocusChapter],
  );

  // What a card in the reading conversation raises. Two do: the diagram card's
  // stepper, which is a `local` patch routed through the session so the step the
  // reader reached is written to the thread and survives reopening it, and an
  // aside's receipt, which navigates back into the side conversation it stands
  // for.
  const onCardAction = useCallback(
    (cardId: string, action: CardAction) => {
      if (action.kind === "navigate") {
        if (action.to === "aside" && action.arg) openAsideThreadRef.current(action.arg);
        return;
      }
      if (action.kind !== "local") return;
      const stage = action.patch.stage;
      if (typeof stage === "number") stepDiagram(cardId, stage);
    },
    [stepDiagram],
  );

  // Pay down whatever the observations still owe, on a timer and whenever the
  // app comes back (src/observation/distill/arrears.ts). Silent throughout: a sweep that
  // finds nothing owed does nothing, and one that runs a pass shows no UI. The
  // predicate keeps it off a thread whose reply is still being written.
  useEffect(() => startDistillSweeps((threadId) => isAnswering(threadId)), [isAnswering]);

  // Conversation-start events: whenever a call opens on a thread it wasn't
  // already logged for (fresh mark, reopened mark, thread switch).
  useEffect(() => {
    const id = call?.threadId ?? null;
    if (id && id !== lastCallThreadRef.current) {
      const topicId = ctxRef.current.topicId;
      if (topicId) {
        logEvent(topicId, "call-start", {
          threadId: id,
          book: call?.isBook ?? false,
          // Which door a side conversation came in by, and nothing at all when it
          // is not one: how often the reader steps out of a lesson, and out of
          // which of the two, is the measurement this shape was chosen on.
          ...(call?.aside ? { aside: call.aside.from } : {}),
        });
      }
    }
    lastCallThreadRef.current = id;
  }, [call?.threadId, call?.isBook, call?.aside]);

  // A page citation carrying a source quote: confirm the quote against the
  // page's extracted text (fulltext cache), then hand the reader the exact
  // on-page substring to highlight. When the text layer isn't available or the
  // quote isn't found, the reader still shows it as a banner (Tier B).
  const jumpToQuote = useCallback(async (pageIndex: number, quote: string) => {
    let searchText = quote;
    try {
      const ft = await currentFulltextRef.current;
      const pageText = ft?.pages?.[pageIndex];
      const located = pageText ? locateQuote(pageText, quote) : null;
      if (located) searchText = located.text;
    } catch {
      // Fulltext unavailable — fall through with the model's quote as-is.
    }
    await viewRef.current?.highlightQuote(pageIndex, { searchText, displayText: quote });
  }, []);

  // A clicked citation chip in a chat reply. Survey pages jump the reader (and
  // un-cover it when chat is full-window); paper citations open that paper's
  // note in the prep panel (v1: the note, not the paper PDF).
  const onCitation = useCallback((c: Citation) => {
    const topicId = ctxRef.current.topicId;
    if (topicId) {
      const detail: Record<string, string | number> =
        c.kind === "page"
          ? { kind: "page", page: c.page }
          : c.kind === "figure"
            ? { kind: "figure", id: c.id }
            : { kind: "paper", slug: c.slug };
      logEvent(topicId, "citation-click", detail);
    }
    if (c.kind === "page") {
      const pageIndex = c.page - 1;
      if (c.quote) void jumpToQuote(pageIndex, c.quote);
      else viewRef.current?.navigate({ pageIndex });
    } else if (c.kind === "figure") {
      // Reachable when this document's figure list is empty, which is both "no
      // figures in it" and "extraction hasn't finished" — nothing here can tell
      // those apart. Either way the jump has nowhere to go, so say so rather
      // than do nothing. (With a figure list, an unknown id never gets here: it
      // renders as an inert chip instead of a control.)
      const fig = findFigureById(figuresRef.current, c.id);
      if (!fig) {
        pushToast("warn", `No figure ${c.id} in this document.`);
        return;
      }
      viewRef.current?.navigate({ pageIndex: fig.page - 1 });
    } else {
      // The model can cite a paper that isn't prepped — an abbreviated slug, or
      // one it remembers from another book. Selecting it opened the prep panel
      // on nothing, which reads as the panel being broken. Say so instead.
      //
      // Only once there is a list to check against: prep state loads a moment
      // after the book does, and a citation clicked in that window is very
      // likely real. No state means open the panel and let it catch up.
      const papers = pipelineRef.current?.snapshot().state?.papers;
      if (papers && !papers.some((p) => p.slug === c.slug)) {
        pushToast("warn", `No prepped paper "${c.slug}" — the reply cited one that isn't here.`);
        return;
      }
      setSelectedPrepSlug(c.slug);
      setSidebarTab("prep");
      setSidebarOpen(true);
    }
    // Chat covering the reader has to get out of the way of the page it just
    // jumped to. A citation tapped in the bubble covers nothing, so it stays.
    swapToReading();
  }, [jumpToQuote, swapToReading, setSelectedPrepSlug, pipelineRef, pushToast]);

  // AI observations are a topic-level thing and show in the topic's sidebar
  // (ui/components/library/topic/ObservationSection.tsx, docs/31); the reader has
  // no copy of them. What is left here is the panel's old refresh signal, which
  // the topic panel subscribes to itself.

  // The chapter-spine half of prep (docs/09): the panel's state and every
  // callback that serves it. It reads the open book through the shell's refs, so
  // what it returns is stable the way it was when this code sat here.
  const {
    snapshot: spineSnap,
    panel: spinePanelProps,
    progress: chapterPrepProgress,
    start: startChapterPrep,
    reset: resetChapterSpine,
    resume: resumeChapterSpine,
  } = useChapterSpine({
    bookIdRef,
    ctxRef,
    currentFulltextRef,
    currentFiguresRef,
    bufferRef,
    annsRef,
    pushToast,
  });

  // The two things that start preparation (docs/09): a mark landing, and the
  // top-bar lecture entry. Which of the two kinds of prep runs is decided per
  // document by the citation density, so this is the only caller that needs to
  // see both halves.
  const {
    onMark: onMarkPrepTrigger,
    onEntry: onEntryPrepTrigger,
    onClose: finalPassPrep,
  } = usePrepTrigger({
    bookIdRef,
    ctxRef,
    currentFulltextRef,
    annsRef,
    startChapters: startChapterPrep,
    startPapers: startPaperPrep,
  });

  // Engine created/modified annotations (drag-to-highlight, AI-pen underline, etc.).
  // A brand-new annotation drawn while the AI pen is active starts a thread and
  // opens the call bubble.
  const onSaveAnnotations = useCallback(
    (incoming: Annotation[]) => {
      let aiCreated: { annotation: Annotation; threadId: string } | null = null;
      let newMark = false;
      for (const a of incoming) {
        const { onlyTextOrComment, ...clean } = a as Annotation & { onlyTextOrComment?: boolean };
        void onlyTextOrComment;
        const isNew = !annsRef.current.has(clean.id);
        if (isNew) newMark = true;
        const prev = annsRef.current.get(clean.id);
        let entry = prev ? { ...prev, ...clean } : clean;
        if (isNew && aiPenRef.current && !entry.aiThreadId) {
          const threadId = crypto.randomUUID();
          entry = { ...entry, aiThreadId: threadId };
          aiCreated = { annotation: entry, threadId };
        }
        annsRef.current.set(clean.id, entry);
      }
      persistAnnotations();
      syncTraceList();
      // A new mark is the only signal for the highlight trigger (docs/09): page
      // navigation is not, so the frontier only ever advances on a fresh mark.
      if (newMark) onMarkPrepTrigger();

      if (aiCreated) {
        // Persist the aiThreadId into the engine model, open the thread + bubble.
        // A chat mark has no page anchor and is never the engine's to draw.
        if (isPageMark(aiCreated.annotation)) viewRef.current?.setAnnotations([aiCreated.annotation]);
        const bookId = bookIdRef.current;
        // Drawn while the lesson is live: this is a side conversation off it
        // (docs/09), not an independent one. Everything else about the mark is
        // unchanged — it keeps its thread back-pointer and its place in the
        // trace list, and the bubble opens beside it exactly as it does with no
        // lesson running. With no lesson, nothing here changes at all: 19 of 23
        // of this reader's marked conversations happen hours or days from one.
        const lesson = currentCall();
        const parentThreadId = lesson?.isBook ? lesson.threadId : null;
        if (bookId && parentThreadId) {
          createAsideThread(bookId, aiCreated.threadId, {
            parentThreadId,
            annotationId: aiCreated.annotation.id,
          });
        } else if (bookId) {
          createThread(bookId, aiCreated.annotation.id, aiCreated.threadId);
        }
        const up = penUpRef.current;
        const rect = readerPaneRef.current?.getBoundingClientRect();
        const anchor = up
          ? { x: up.x, y: up.y }
          : { x: (rect?.left ?? 0) + (rect?.width ?? 480) / 2, y: (rect?.top ?? 0) + 240 };
        setPopup(null);
        // A brand-new thread has nothing stored: the bubble opens on the
        // opening intents and sends nothing until one is pressed (docs/03).
        openThreadCall(
          {
            threadId: aiCreated.threadId,
            annotationId: aiCreated.annotation.id,
            // Through asideFraming like every other door, so the span is the
            // one shape everywhere: one line, cut to the same length.
            // `parentView` is what the reader had the lesson in when they drew —
            // the corner card, in the flow this is for — and going back restores
            // it rather than putting chat over the page they were reading.
            ...(parentThreadId
              ? asideFramingFor(
                  { annotationId: aiCreated.annotation.id, parentThreadId },
                  lesson?.view,
                )
              : {}),
            view: "bubble",
            anchor,
          },
          [],
        );
      }
    },
    [persistAnnotations, syncTraceList, openThreadCall, currentCall, onMarkPrepTrigger],
  );

  const onDeleteAnnotations = useCallback(
    (ids: string[]) => {
      for (const id of ids) annsRef.current.delete(id);
      const bookId = bookIdRef.current;
      if (bookId) deleteAnnotations(bookId, ids);
      syncTraceList();
    },
    [syncTraceList],
  );

  // The conversation a mark is a door into, when this device still has it
  // (reading/chat-marks.ts: markDoorThread). Every press on a mark asks here
  // first: annotations and threads sync as two files, so an id with no record
  // behind it is a door to nothing, and opening a call on it would make an empty
  // conversation the reader cannot get out of.
  const hasThread = useCallback((threadId: string) => {
    const bookId = bookIdRef.current;
    return !!bookId && getThread(bookId, threadId) !== undefined;
  }, []);

  const markDoor = useCallback(
    (ann: { id: string; aiThreadId?: unknown } | null | undefined) => {
      const bookId = bookIdRef.current;
      const threadId = markDoorThread(ann, hasThread);
      const thread = bookId && threadId ? getThread(bookId, threadId) : undefined;
      return threadId && thread ? { threadId, thread } : null;
    },
    [hasThread],
  );

  // Clicking a mark. The engine shares the shell's document, so the rect is
  // already in viewport coordinates. An AI-pen mark (has aiThreadId) opens its
  // call bubble with history instead of the annotation editor.
  const onSetAnnotationPopup = useCallback((params?: AnnotationPopupParams) => {
    if (!params) {
      setPopup(null);
      return;
    }
    const [l, , r, bottom] = params.rect;
    const anchor = { x: (l + r) / 2, y: bottom };
    const ann = params.annotation;
    const door = markDoor(ann);
    if (door) {
      setPopup(null);
      reopenThreadCall(door.thread, { view: "bubble", anchor });
    } else {
      setPopup({ annotation: ann, anchor });
    }
  }, [reopenThreadCall, markDoor]);

  // A pen stroke on a reply (docs/09). The classroom's answers are the book
  // continued, so this writes the same kind of entry the page path writes, into
  // the same file — anchored on the message rather than on a page
  // (reading/chat-marks.ts) and never handed to the engine.
  //
  // The AI pen also opens the second level: a side conversation off the lesson,
  // on the words that were marked. It is written down at once rather than at the
  // first question, exactly as one drawn on the page is — the mark is a door
  // into it from the moment it exists.
  const drawChatMark = useCallback(
    (draw: ChatMarkDraw) => {
      const lesson = currentCall();
      if (!bookIdRef.current || !lesson) return;
      // What the aside would be about. Null when the AI pen was not the one
      // drawing, and when what it caught is too short to be a question — that
      // stroke is then an underline and nothing more, rather than a mark
      // pointing at a conversation that was never opened.
      // The stroke's words as a person reads them, which is not the string it is
      // found again by when it crossed a block (reading/chat-marks.ts:
      // chatMarkWords). The whole draw is spread into the mark rather than
      // copied field by field: the verbatim string, the copy of it and the
      // readable one travel together or the mark is anchored on one and shown
      // as another.
      const asideAnchor = draw.pen === "ai" ? asideAnchorAt(draw.messageTs, chatMarkWords(draw)) : null;
      const aiThreadId = asideAnchor ? crypto.randomUUID() : undefined;
      const mark = buildChatMark({
        ...draw,
        id: crypto.randomUUID(),
        color: draw.pen === "ai" ? AI_PEN_COLOR : penColor,
        threadId: lesson.threadId,
        ...(aiThreadId ? { aiThreadId } : {}),
      });
      if (!mark) return;
      annsRef.current.set(mark.id, mark);
      persistAnnotations();
      syncTraceList();
      // No prep trigger: that frontier is measured in pages and this mark is on
      // none (reading/prep/use-prep-trigger.ts skips a mark with no page).
      if (!asideAnchor || !aiThreadId) return;
      setPopup(null);
      // The same door the pen opens on the page, one level down: openChatAside
      // takes the isBook guard with it, so an AI pen that reached here inside a
      // side conversation opens nothing and the mark still stands.
      openChatAside(asideAnchor, { annotationId: mark.id, threadId: aiThreadId });
    },
    [penColor, persistAnnotations, syncTraceList, currentCall, openChatAside],
  );

  // A press on a mark drawn on a reply. An AI-pen one is the door into the
  // conversation it opened, the same as on the page; the other two raise the
  // same editor a mark on the page raises, at the words that were pressed.
  const openChatMark = useCallback(
    (ann: Annotation, at: { x: number; y: number }) => {
      const door = markDoor(ann);
      if (!door) {
        // No conversation behind it, or none left on this device: the editor at
        // the words that were pressed, which is all such a mark has to show.
        setPopup({ annotation: ann, anchor: at });
        return;
      }
      setPopup(null);
      reopenThreadCall(door.thread, { view: "chat-main", anchor: at });
    },
    [reopenThreadCall, markDoor],
  );

  // The pen stroke gives the host no coordinates, so track the last pen-lift
  // over the reader pane as the AI-pen bubble anchor (capture phase, so nothing
  // inside the engine can swallow it).
  const onPanePointerUp = useCallback((e: React.PointerEvent) => {
    penUpRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  // What the two sequences below do to the screen and to the shell's refs.
  // Which of them happen, in what order and what is skipped when, is
  // reading/session's (open-book.ts, close-book.ts) — this is only the wiring.
  const readerShell = useMemo<ReaderShell>(
    () => ({
      showStatus: setStatus,
      pushToast,
      closeAnnotationPopup: () => setPopup(null),
      captureHangup,
      closeCall,
      discardStagedImages,
      endBookTurns,
      clearSelectedMark: () => setSelectedAnnId(null),
      resetTool: () => setPickedTool("none"),
      showMarks: (marks) => {
        // Every mark of the book, both kinds: the map is what gets written back
        // and what the trace list is built from. Only the engine's copy is
        // filtered, and that happens where the reader is mounted (open-book.ts).
        annsRef.current = new Map(marks.map((a) => [a.id, a]));
        setTraceAnns(orderTraceMarks(marks));
      },
      readerNotReady: () => setViewReady(false),
      takeBook: (bookId, name, buffer) => {
        bookIdRef.current = bookId;
        bookNameRef.current = name;
        bufferRef.current = buffer;
      },
      currentBookId: () => bookIdRef.current,
      restartDwell: () => {
        pageDwellRef.current = null;
      },
      releaseBook: () => {
        bookIdRef.current = null;
        viewRef.current = null;
        pageDwellRef.current = null;
      },
      resetPrep,
      resumePrep,
      resetChapterSpine,
      resumeChapterSpine,
      finalPassPrep,
      trackFulltext: (extraction) => {
        currentFulltextRef.current = extraction;
      },
      trackFigures: (extraction) => {
        currentFiguresRef.current = extraction;
      },
      showFulltext: (ft, pending) => {
        setFulltext(ft);
        setFulltextPending(pending);
      },
      showFigures: (list) => {
        figuresRef.current = list;
        setFigures(list);
      },
      mountReader: setEmbedDoc,
      unmountReader: () => setEmbedDoc(null),
      showTitle: setTitle,
    }),
    [
      captureHangup,
      closeCall,
      discardStagedImages,
      endBookTurns,
      finalPassPrep,
      pushToast,
      resetChapterSpine,
      resetPrep,
      resumeChapterSpine,
      resumePrep,
    ],
  );

  const openInReader = useCallback(
    (bookId: string, name: string, bytes: Uint8Array) => openBook(readerShell, { bookId, name, bytes }),
    [readerShell],
  );

  // Open a topic file. If its book id is known and the library holds the
  // authoritative copy, open straight from the library (the original path may be
  // gone). Otherwise read the original, import a copy into the library, migrate
  // any legacy path-hash-keyed data to the book id, and backfill the id.
  const openFile = useCallback(
    // topicId defaults to the active topic; the vestibule's "Continue reading"
    // passes it explicitly since it opens a book without entering that topic.
    async (file: FileRef, topicId?: string) => {
      const tid = topicId ?? activeTopicId;
      if (!tid) return;
      try {
        const { bookId, bytes } = await resolveBookSource(file, tid);
        await openInReader(bookId, file.name, bytes);
        await markOpened(tid, file.path);
        await refreshTopics();
      } catch (e) {
        console.error("failed to open file", e);
        pushToast("error", "Can't open this file — it may have been moved or deleted.");
      }
    },
    [activeTopicId, openInReader, refreshTopics, pushToast],
  );

  const addFile = useCallback(async () => {
    if (!activeTopicId) return;
    const selected = await open({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (typeof selected !== "string") return;
    await addFileToTopic(activeTopicId, selected);
    await refreshTopics();
  }, [activeTopicId, refreshTopics]);

  const continueReading = useCallback(() => {
    const recent = mostRecentlyOpened(topics ?? []);
    if (!recent) {
      setHomeScreen("library");
      return;
    }
    void openFile(recent.file, recent.topic.id);
  }, [topics, openFile]);

  // Host-side edit of an existing annotation: patch, re-render, persist.
  const patchAnnotation = useCallback(
    (id: string, patch: Partial<Annotation>) => {
      const prev = annsRef.current.get(id);
      if (!prev) return;
      const updated: Annotation = { ...prev, ...patch, dateModified: new Date().toISOString() };
      annsRef.current.set(id, updated);
      if (isPageMark(updated)) viewRef.current?.setAnnotations([updated]);
      persistAnnotations();
      syncTraceList();
      setPopup((p) => (p && p.annotation.id === id ? { ...p, annotation: updated } : p));
    },
    [persistAnnotations, syncTraceList],
  );

  // Trace-list click: jump to the mark. Programmatic select does not open the
  // popup (pitfall 04), which is what we want for a list jump.
  const onTraceSelect = useCallback(
    (id: string) => {
      const action = traceSelectAction(annsRef.current.get(id), hasThread);
      if (action.act === "mark") {
        // A classroom mark with nothing left to open: the row is the only place
        // those words are shown, so the drawer stays open around it. Closing it
        // would answer the press with an empty screen.
        setSelectedAnnId(id);
        return;
      }
      // Same as the outline jump: leaving the drawer open parks its backdrop
      // over the page we just navigated to, and the backdrop only answers a tap.
      setSidebarOpen(false);
      setSelectedAnnId(id);
      if (action.act === "page") {
        viewRef.current?.selectAnnotations([id]);
        viewRef.current?.navigate({ annotationID: id });
        return;
      }
      const bookId = bookIdRef.current;
      const thread = bookId ? getThread(bookId, action.threadId) : undefined;
      // The row is a door into the conversation the mark opened, or failing that
      // into the lesson it was drawn in — which is the book's own, and reopening
      // it as anything else takes the AI pen, the chips and the empty-state line
      // away from it (reading/reopen.ts).
      if (thread) reopenThreadCall(thread, { view: "chat-main", anchor: { x: 0, y: 0 } });
    },
    [reopenThreadCall, hasThread],
  );

  // Does the active default model accept images? (Gates a paste up front.)
  const modelTakesImages = useCallback(() => {
    const s = settingsRef.current;
    return !!(
      s.defaultProviderId &&
      s.defaultModelId &&
      modelSupportsImages(s.defaultProviderId as ProviderId, s.defaultModelId)
    );
  }, []);

  // One global paste path (single owner, focus-independent). While a call is
  // open: prefer image items on the DOM clipboard event (Chrome / future iPad);
  // if the event carries no image and no text, fall back to reading the system
  // clipboard through Tauri (WebKitGTK drops image data from the paste event,
  // pitfall 16). Any failure surfaces an inline hint — never a silent drop.
  useEffect(() => {
    if (!call) return;
    // Whatever is pasted belongs to the conversation that was open when it was
    // pasted, even if the answer to it arrives after the user has moved on.
    const threadId = call.threadId;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      const blobs: Blob[] = [];
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind === "file" && item.type.startsWith("image/")) {
            const f = item.getAsFile();
            if (f) blobs.push(f);
          }
        }
      }
      if (blobs.length > 0) {
        e.preventDefault();
        if (!modelTakesImages()) {
          noteImageHint(threadId, "This model can't read images. Switch to a vision model in Settings.");
          return;
        }
        noteImageHint(threadId, "");
        for (const b of blobs) stageImage(threadId, () => compressImage(b));
        return;
      }
      // No image in the DOM event. Text paste keeps its default behaviour.
      const text = e.clipboardData?.getData("text") ?? "";
      if (text.trim() !== "" || !isTauri()) return;
      // WebKitGTK: the image never reached the event — read it from Rust.
      e.preventDefault();
      void (async () => {
        const img = await readClipboardImage();
        if (!img) {
          noteImageHint(threadId, "Couldn't read an image from the clipboard.");
          return;
        }
        if (!modelTakesImages()) {
          noteImageHint(threadId, "This model can't read images. Switch to a vision model in Settings.");
          return;
        }
        noteImageHint(threadId, "");
        stageImage(threadId, () => compressImageData(img.rgba, img.width, img.height));
      })();
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [call, stageImage, noteImageHint, modelTakesImages]);

  // Delete a mark from the trace list. This is the only way to get rid of an
  // AI-pen mark: tapping one on the page opens its conversation, so the
  // annotation editor's Delete never reaches it.
  //
  // The mark and its thread go together. The mark is the thread's only door —
  // tapping it on the page, or its sparkle in the trace list — so a thread left
  // behind is a conversation nothing can ever open again, syncing forever. That
  // is the same pairing the ✕'s delete already makes from the other end, and
  // both ends now go through the same one in the session: the threads file, the
  // turn, the staging and the event line are all keyed by thread id and none of
  // them is this file's. The mark goes through removeAnnotation like every other
  // deletion, so the annotations file, the in-memory map and sync stay in
  // agreement. What was distilled from the talk stays.
  const deleteTraceAnnotation = useCallback(
    (id: string) => {
      dropThread(id, annsRef.current.get(id)?.aiThreadId as string | undefined);
      removeAnnotation(id);
    },
    [dropThread, removeAnnotation],
  );

  const openThreadForAnnotation = useCallback(
    (annotationId: string) => {
      const ann = annsRef.current.get(annotationId);
      const { jump, threadId } = markOpenAction(ann, hasThread);
      if (jump) {
        viewRef.current?.selectAnnotations([annotationId]);
        viewRef.current?.navigate({ annotationID: annotationId });
      }
      setSelectedAnnId(annotationId);
      // The conversation is gone: the row still shows the words that were
      // marked, and there is nothing to open beside them.
      if (!threadId) return;
      const bookId = bookIdRef.current;
      const thread = bookId ? getThread(bookId, threadId) : undefined;
      if (thread) reopenThreadCall(thread, { view: "chat-main", anchor: { x: 0, y: 0 } });
    },
    [reopenThreadCall, hasThread],
  );

  // The receipt chip in a conversation's transcript (ui/components/reader/
  // AsideCard.tsx): reopen the side conversation it stands for. This is the only
  // door into one that was pulled out of a reply — it has no mark, so the trace
  // list never holds it — and it is why the chip is a durable card part.
  const openAsideThread = useCallback(
    (threadId: string) => {
      const bookId = bookIdRef.current;
      const thread = bookId ? getThread(bookId, threadId) : undefined;
      const framing = asideFramingFor(thread);
      if (!thread || !framing.aside) {
        pushToast("warn", "That side conversation is gone.");
        return;
      }
      reopenThreadCall(thread, { view: "chat-main", anchor: { x: 0, y: 0 } });
    },
    [reopenThreadCall, asideFramingFor, pushToast],
  );
  openAsideThreadRef.current = openAsideThread;

  // Top-bar AI button: the selection-free entry (docs/03). One persistent
  // book-level thread per book — created on first press, reopened with its
  // history on later presses (and after hangup), the way a mark hosts its
  // thread. It has no anchor, so it never joins the trace list; this button is
  // how it is reached once it has been hung up, and while it is up the button
  // goes dim and the corner card is the door. Opens straight to the main call
  // view, skipping the bubble.
  //
  // Which thread that is comes from the file, not from the cache: see
  // reading/session/book-thread.ts.
  const openBookThread = useCallback(() => {
    const bookId = bookIdRef.current;
    if (!bookId) return;
    // Pressing the entry is the intent, so it is also what starts preparation on
    // a document nobody has marked (docs/09). Fire-and-forget and off the
    // conversation's path: the lecture never waits for prepared material.
    onEntryPrepTrigger();
    void (async () => {
      const resolved = await resolveBookThread(bookId, () => bookIdRef.current !== bookId);
      if (resolved.status === "unreadable") {
        pushToast("warn", "Saved AI conversations could not be loaded");
        return;
      }
      if (resolved.status === "cancelled") return;
      const { thread } = resolved;
      setPopup(null);
      reopenThreadCall(thread, { view: "chat-main", anchor: { x: 0, y: 0 } });
    })();
  }, [reopenThreadCall, pushToast, onEntryPrepTrigger]);

  // Jump the reading back to the thread's mark (from the reading corner card).
  // The book-level thread has no mark, so there is nothing to jump to.
  // A conversation anchored on a mark drawn on a reply has no place either: the
  // engine has never heard of that mark, and asking it to navigate names a page
  // that does not exist.
  const onPositionClick = useCallback(() => {
    const c = currentCall();
    if (!c || !c.annotationId) return;
    if (!isPageMark(annsRef.current.get(c.annotationId))) return;
    viewRef.current?.selectAnnotations([c.annotationId]);
    viewRef.current?.navigate({ annotationID: c.annotationId });
  }, [currentCall]);

  const closeReader = useCallback(() => {
    closeBook(readerShell, bookIdRef.current);
  }, [readerShell]);

  // Stable handlers for the EmbedPDF pane so its React.memo actually holds: any
  // new prop identity here would re-render the whole engine subtree on every
  // shell state change (e.g. AI streaming), which is the popup-jank regression.
  const onEmbedView = useCallback((v: ViewInstance) => {
    viewRef.current = v;
  }, []);
  const onEmbedInitialized = useCallback(() => {
    setStatus("");
    setViewReady(true);
  }, []);
  // The book did not open. Nothing further is coming: the reading area stays
  // empty and onEmbedInitialized never fires, so the status line would go on
  // saying "Rendering…" forever and look exactly like a slow load. Say it
  // instead — the toast names the book while it lasts, the status line keeps
  // saying so beside the title, and the engine's own text goes to the console.
  const onEmbedError = useCallback(
    (e: Error) => {
      const text = openFailureText(bookNameRef.current, e);
      console.error(text.detail, e);
      setStatus(text.status);
      pushToast("error", text.toast);
    },
    [pushToast],
  );
  const onEmbedSelect = useCallback((ids: string[]) => setSelectedAnnId(ids[0] ?? null), []);

  // Escape closes whatever is topmost (Settings, else a side conversation — which
  // steps back to the one it came off rather than out of both — else the open
  // call, same path as the hang-up button, else the annotation popup); Ctrl/Cmd+\
  // toggles the sidebar. Escape works even while a composer has focus; the
  // sidebar toggle is ignored while typing so it doesn't fight text input. The
  // session's own reference to the open call (not `call`) keeps this listener
  // stable across a streaming reply's frequent state churn.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === "Escape") {
        if (showSettings) setShowSettings(false);
        else if (quoteHlActive) viewRef.current?.clearQuoteHighlight();
        else if (currentCall()?.aside) returnFromAside();
        else if (currentCall()) endCall();
        else if (popup) setPopup(null);
        else if (sidebarOpen) setSidebarOpen(false);
        return;
      }
      const target = e.target as HTMLElement | null;
      const typing =
        !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
        e.preventDefault();
        setSidebarOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showSettings, popup, endCall, currentCall, returnFromAside, quoteHlActive, sidebarOpen]);

  // Which half of prep this document gets. Whichever run exists on disk wins;
  // with neither, the citation density decides (reading/prep/kind.ts). Read off
  // the snapshots rather than the store, so the panel follows a run that has
  // just started without waiting for anything to be written.
  const panelPrepKind = prepKind({
    papers: !!prepSnap?.state,
    chapters: !!spineSnap?.state,
    // Still extracting: "unknown" is the honest answer, and it is what the panel
    // shows until the text is in.
    shape: fulltext ? documentShape(fulltext) : "unknown",
  });

  // Background work the drawer would show if open (either half of prep): the
  // toggle carries a status dot so progress is visible while the drawer is shut.
  const sidebarBusy = !!(prepSnap?.running || spineSnap?.running);

  // What the status line above a conversation says about preparation (docs/09).
  // Only while a run is actually going: the line is a report on work in flight,
  // and a finished run has nothing to say there. Whichever half is running is
  // the one this document got — they are never both.
  const prepLineProgress = spineSnap?.running
    ? chapterPrepProgress
    : prepSnap?.running
      ? paperPrepProgress
      : null;

  const inReader = !!title;
  // A bubble on a conversation that has not started, with nowhere to send it:
  // the Settings guidance takes the bubble's place. `configured` is what decides
  // it — an empty bubble is now the ordinary opening state (it offers the intent
  // chips), so emptiness on its own says nothing about the provider.
  const showGuidance = call?.view === "bubble" && call.messages.length === 0 && !configured;
  const lastCallMsg = call?.messages[call.messages.length - 1];
  const streaming = !!(lastCallMsg?.role === "ai" && lastCallMsg.streaming);

  // Ctrl/Cmd + = / - / 0 on the page. No control goes with it: the More menu
  // already carries the three visible zoom items.
  useReaderZoomKeys({
    view: viewRef,
    layout: stats?.layout,
    ctx: { inReader, chatFullWindow: call?.view === "chat-main" },
  });

  // What an empty conversation offers. The chapter chip is resolved against
  // where the reader is scrolled *now* — the one moment a scroll position
  // decides anything (docs/09) — and disappears on a book with no usable
  // chapter table. A side conversation has its own set: one opened on words out
  // of a reply has no marked passage, and nothing offered there may claim it has
  // (reading/intents.ts).
  const callIntents = call?.aside
    ? asideIntents(call.aside.from)
    : openingIntents(
        call?.isBook ?? false,
        chapterAtPage(bookChapters ?? [], stats ? stats.pageIndex + 1 : null),
      );
  intentsRef.current = callIntents;

  // The two pens, aimed at the conversation on screen (docs/09). The rack is
  // always live and its target follows the main view: the classroom covers the
  // reader, so while it is up a stroke lands on a reply. Only there — in the
  // corner bubble the page is what the reader is looking at.
  //
  // Whether the AI pen is on offer at all was settled above, in the tool: a rack
  // that cannot open a level is not holding it.
  const chatPen: MarkPen | null =
    toolType === "none" || toolType === "navlock" ? null : toolType;
  const chatMarkHost = useMemo<ChatMarkHost | null>(
    () =>
      call?.view === "chat-main" && call.threadId
        ? {
            threadId: call.threadId,
            pen: chatPen,
            color: chatPen === "ai" ? AI_PEN_COLOR : penColor,
            marks: traceAnns,
            onDraw: drawChatMark,
            onOpen: openChatMark,
          }
        : null,
    [call?.view, call?.threadId, chatPen, penColor, traceAnns, drawChatMark, openChatMark],
  );

  // The empty state, and whether there is a lesson to go back to.
  //
  // A side conversation drawn on the page is a marked passage like any other and
  // keeps the passage wording (docs/09); only one pulled out of a reply has no
  // passage to name. And a conversation whose parent is gone — a delete that
  // arrived from another device — still says what it is about, without offering
  // a way back that could only apologise. The way on from there is the
  // blackboard, which the gate lights for exactly this case.
  const spanAside = call?.aside?.from === "chat";
  const asideBack =
    call?.aside && parentThreadThere(call.aside.parentThreadId) ? returnFromAside : undefined;

  // And why it is short, while it is. Extracting the text is what the chapter
  // chip waits on, and on a long book that is tens of seconds of the entry
  // looking like it has nothing to offer.
  const callNote = call?.isBook
    ? bookTextNotice(
        fulltextPending ? "extracting" : fulltext?.status === "ok" ? "ok" : "unreadable",
      )
    : null;

  // Host for inline [fig:N] cards (M9): resolve/raster/jump against the open
  // book. Null when the book has no figures, so cards fall back to text chips.
  const figureHost = useMemo<FigureHost | null>(() => {
    if (figures.length === 0) return null;
    return {
      getFigure: (id) => findFigureById(figures, id),
      renderCard: async (figure) => {
        const buf = bufferRef.current;
        const bookId = bookIdRef.current;
        if (!buf || !bookId) return null;
        const r = await renderFigure(bookId, buf, figure, "card");
        return r ? { src: r.dataUrl, width: r.width, height: r.height } : null;
      },
      onJump: (figure) => onCitation({ kind: "figure", id: figure.id }),
    };
  }, [figures, onCitation]);

  // The slugs a [slug p.N] citation may name. Null — not an empty set — until
  // prep state has actually loaded: "this paper isn't prepped" and "the list
  // isn't here yet" are different answers, and only the first should strike a
  // citation back to plain text. Keyed on the slugs themselves so the set keeps
  // its identity across the status changes that fire while prep runs, which is
  // what keeps every rendered reply from re-linkifying each time.
  const prepSlugKey = prepSnap?.state?.papers.map((p) => p.slug).join("\n") ?? null;
  const prepSlugs = useMemo(
    () => (prepSlugKey === null ? null : new Set(prepSlugKey.split("\n").filter(Boolean))),
    [prepSlugKey],
  );

  return (
    <CardRegistryProvider>
    <CitationContext.Provider value={onCitation}>
    <PrepSlugContext.Provider value={prepSlugs}>
    <FigureContext.Provider value={figureHost}>
    {/* p-safe: the insets (iPad, viewport-fit=cover). box-sizing:border-box
        keeps the padding inside the full-height shell. Fixed overlays are not
        covered by it and pad themselves — see docs/pitfall/74. */}
    <div className="flex flex-col h-full p-safe">
      {/* z-10: the color palette drops out of the header into the reader area,
          and <main> is positioned too — without this it would paint over it.
          Three sections: left = navigation, center = tool group, right = AI +
          overflow. The side sections are shrink-0 so they always hold their
          content; the center is the flex-1 that grows to center its tools and,
          when the phone is too narrow for the full rack, scrolls within its own
          band (overflow-x-auto) so the page itself never scrolls. */}
      <header className="relative z-10 flex h-11 flex-none items-center gap-1.5 border-b border-[#dcdcdc] bg-[#fafafa] px-2 sm:gap-2 sm:px-3">
        {inReader ? (
          <ReaderTopBar
            view={viewRef}
            stats={stats}
            viewReady={viewReady}
            sidebarOpen={sidebarOpen}
            sidebarBusy={sidebarBusy}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            onCloseReader={closeReader}
            status={status}
            tool={{ type: toolType, color: penColor }}
            onToolChange={(t) => {
              setPickedTool(t.type);
              setPenColor(t.color);
            }}
            gate={gate}
            onOpenBookThread={openBookThread}
            onOpenSettings={() => setShowSettings(true)}
            settingsAlert={syncReport.alert !== "none"}
          />
        ) : homeScreen === "library" ? (
          <>
            {activeTopic ? (
              <Button variant="outline" onClick={() => setActiveTopicId(null)}>
                ‹ Topics
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setHomeScreen("vestibule")}>
                ‹ Today
              </Button>
            )}
            {activeTopic && <span className="text-[13px] text-[#1b1b1b] overflow-hidden text-ellipsis whitespace-nowrap max-w-[40vw]">{activeTopic.name}</span>}
            <span className="flex-1" />
            <SettingsButton
              alert={syncReport.alert !== "none"}
              onClick={() => setShowSettings(true)}
            />
          </>
        ) : (
          <>
            <span className="flex-1" />
            <SettingsButton
              alert={syncReport.alert !== "none"}
              onClick={() => setShowSettings(true)}
            />
          </>
        )}
      </header>

      <main className="relative flex-1 min-h-0 flex">
        {/* Sidebar sits on the LEFT (Zotero iPad Annotations position); the
            right side is reserved for the future AI column. */}
        {inReader && (
          <Sidebar
            open={sidebarOpen}
            tab={sidebarTab}
            onClose={() => setSidebarOpen(false)}
            onSelectTab={(t) => {
              if (t === "prep" && activeTopic) logEvent(activeTopic.id, "prep-tab-open");
              setSidebarTab(t);
            }}
            fulltext={fulltext}
            fulltextPending={fulltextPending}
            onNavigatePage={(page) => {
              // Close the drawer on the way: its backdrop covers the reader and
              // only answers a tap, so a jump that leaves it open lands on a page
              // the finger cannot scroll.
              setSidebarOpen(false);
              viewRef.current?.navigate({ pageIndex: page - 1 });
            }}
            annotations={traceAnns as unknown as PopupAnnotation[]}
            selectedId={selectedAnnId}
            hasThread={hasThread}
            onSelectAnnotation={onTraceSelect}
            onDeleteAnnotation={deleteTraceAnnotation}
            onOpenThread={openThreadForAnnotation}
            prepPanel={
              <PrepPanel kind={panelPrepKind} papers={prepPanelProps} chapters={spinePanelProps} />
            }
          />
        )}

        <div
          ref={readerPaneRef}
          className="flex-1 min-w-0 h-full"
          onPointerDownCapture={dismissOnPaneTouch}
          onPointerUpCapture={onPanePointerUp}
        >
          {embedDoc && (
            <EmbedReaderPane
              key={embedDoc.bookId}
              buffer={embedDoc.buffer}
              annotations={embedDoc.annotations}
              authorName="Reading-Partner"
              viewState={embedDoc.viewState}
              className="h-full w-full block"
              onView={onEmbedView}
              onInitialized={onEmbedInitialized}
              onError={onEmbedError}
              onChangeViewState={persist}
              onChangeViewStats={setStats}
              onSaveAnnotations={onSaveAnnotations}
              onDeleteAnnotations={onDeleteAnnotations}
              // Native selection already happened — just reflect it (no echo,
              // which would loop through the engine's own selection state).
              onSelectAnnotations={onEmbedSelect}
              onSetAnnotationPopup={onSetAnnotationPopup}
              onQuoteHighlightChange={setQuoteHlActive}
            />
          )}
        </div>

        <InfoHome
          screen={inReader ? null : homeScreen}
          onNavigate={setHomeScreen}
          role={deviceRole}
          continueBook={(() => {
            if (topics === null) return undefined;
            const recent = mostRecentlyOpened(topics);
            return recent ? { title: recent.file.name, topicName: recent.topic.name } : null;
          })()}
          onContinue={continueReading}
          configured={configured}
          launchReady={bootstrapped}
          onOpenSettings={() => setShowSettings(true)}
          onTopicsChanged={refreshTopics}
        />

        {!inReader && homeScreen === "library" && (
          <LibraryScreen
            topics={topics ?? []}
            activeTopic={activeTopic}
            onOpenTopic={(t) => setActiveTopicId(t.id)}
            onAddFile={addFile}
            onOpenFile={openFile}
            onTopicsChanged={refreshTopics}
          />
        )}

        {popup && (
          <AnnotationPopup
            annotation={popup.annotation as unknown as PopupAnnotation}
            anchor={popup.anchor}
            colors={ANNOTATION_COLORS}
            onChange={(id, patch) => patchAnnotation(id, patch)}
            onDelete={(id) => removeAnnotation(id)}
            onClose={() => setPopup(null)}
          />
        )}

        {call?.view === "bubble" && !showGuidance && (
          <CallBubble
            anchor={call.anchor}
            messages={call.messages}
            onSend={sendFromChat}
            onExpand={showChatMain}
            onClose={endCall}
            onDelete={deleteOpenThread}
            pendingImages={pendingImages}
            onRemoveImage={removePendingImage}
            hint={imageHint}
            streaming={streaming}
            onStop={stopTurn}
            onCardAction={onCardAction}
            voice={callVoice}
            intents={callIntents}
            onBackToLesson={asideBack}
          />
        )}

        {/* No provider configured: guide to Settings instead of chatting. The
            bubble is empty either way now, so this is keyed on `configured`
            alone — see showGuidance. */}
        {showGuidance && call && (
          <div
            className={`fixed anchor-safe ${OVERLAY_Z.floating} flex w-[300px] flex-col gap-3 rounded-xl border border-black/10 bg-white p-4 shadow-[0_8px_40px_rgba(0,0,0,0.18)]`}
            // anchor-safe clamps this inside the safe area (docs/pitfall/74) and
            // re-solves on resize and rotation, which the viewport width read
            // once at render did not. --anchor-h is an estimate: the card holds
            // one line and a button row.
            style={
              {
                "--anchor-x": `${call.anchor.x - 150}px`,
                "--anchor-y": `${call.anchor.y + 10}px`,
                "--anchor-w": "300px",
                "--anchor-h": "160px",
              } as CSSProperties
            }
          >
            <p className="m-0 text-sm text-neutral-700">Configure a provider in Settings to start chatting.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={endCall}>
                Dismiss
              </Button>
              <Button onClick={() => setShowSettings(true)}>
                Open Settings
              </Button>
            </div>
          </div>
        )}

        {/* A failed turn stays visible; offer a retry (docs/03: errors not swallowed). */}
        {call?.error && (
          <button
            className={`fixed bottom-safe-6 left-1/2 ${OVERLAY_Z.floatingTop} -translate-x-1/2 rounded-full border border-[#dcdcdc] bg-white px-4 py-1.5 text-sm shadow-md hover:bg-[#f0f0f0]`}
            onClick={retryCall}
          >
            Retry
          </button>
        )}

        {/* chat-main: chat takes the whole window over the still-mounted reader
            (z-cover, reading state kept), reading shrinks to the corner card. */}
        {call?.view === "chat-main" && (
          <>
            <div className="absolute inset-0 z-40">
              <CallView
                messages={call.messages}
                onSend={sendFromChat}
                onHangUp={endCall}
                onDelete={deleteOpenThread}
                pendingImages={pendingImages}
                onRemoveImage={removePendingImage}
                hint={imageHint}
                streaming={streaming}
                onStop={stopTurn}
                onCardAction={onCardAction}
                chapterFocus={
                  // A side conversation has no chapter of its own — it reads the
                  // one its parent is parked on — and the line it does want is
                  // the aside bar, which takes the same slot.
                  call.aside
                    ? null
                    : {
                        // The chapter as the book names it: `number` is parsed
                        // out of the title, so the title already carries it.
                        // Absent when the conversation has not settled on one,
                        // which the line handles — preparation can be running
                        // with no chapter in focus.
                        ...(focusChapter
                          ? {
                              chapter: focusChapter.title,
                              firstPage: focusChapter.startPage,
                              lastPage: focusChapter.endPage,
                              onClear: () => setFocusChapter(null),
                            }
                          : {}),
                        prep: prepLineProgress,
                      }
                }
                aside={call.aside ? { span: call.aside.span, onBack: asideBack } : undefined}
                marks={chatMarkHost}
                emptyTitle={
                  spanAside ? "Ask about this" : call.isBook ? title ?? "This book" : undefined
                }
                placeholder={
                  spanAside ? "Ask about this…" : call.isBook ? "Ask about this book…" : undefined
                }
                intents={callIntents}
                emptyNote={callNote}
                voice={callVoice}
              />
            </div>
            <div className="absolute right-3 top-3 z-50">
              {(() => {
                // What the reader is looking at, so only a mark on the page has
                // one. A conversation off a marked reply would otherwise print
                // the AI's own words on the card that says where the book is.
                const anchoring = annsRef.current.get(call.annotationId);
                const excerpt = (isPageMark(anchoring) ? markExcerpt(anchoring) : "") || null;
                return (
                  <ReadingPipCard
                    title={title ?? ""}
                    badge={
                      stats?.pageLabel ? (
                        <span className="shrink-0 text-[11px] text-neutral-400">p. {stats.pageLabel}</span>
                      ) : undefined
                    }
                    body={
                      excerpt ? (
                        <span className="line-clamp-3 text-[12px] italic leading-snug text-neutral-500">
                          “{excerpt}”
                        </span>
                      ) : undefined
                    }
                    onClick={() => {
                      onPositionClick();
                      swapToReading();
                    }}
                  />
                );
              })()}
            </div>
          </>
        )}

        {/* chat-pip: reading is back; the call persists as the corner chat card. */}
        {call?.view === "chat-pip" && (
          <div className="absolute right-3 top-3 z-50">
            <ChatPipCard
              lastMessage={chatGlance(call.messages)}
              onClick={showChatMain}
              onHangUp={endCall}
            />
          </div>
        )}

      </main>

      <Toast toasts={toasts} onDismiss={dismissToast} />

      {showSettings && (
        <SettingsView
          settings={settings}
          onSettingsChange={applySettings}
          device={device}
          onDeviceChange={applyDevice}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
    </FigureContext.Provider>
    </PrepSlugContext.Provider>
    </CitationContext.Provider>
    </CardRegistryProvider>
  );
}

// Whether a side conversation still has somewhere to go back to: a record under
// its parent link that is not itself an aside (reading/aside.ts). Read at render
// rather than settled when it opened, because the parent can go while it is open
// — another device's delete arrives through sync.
function asideReturnable(bookId: string | null, parentThreadId: string): boolean {
  if (!bookId) return false;
  const parent = getThread(bookId, parentThreadId);
  return !!parent && !!asideReturn(parent);
}

