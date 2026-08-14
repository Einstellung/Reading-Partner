import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  type Annotation,
  type AnnotationPopupParams,
  type ViewInstance,
  type ViewState,
  type ViewStats,
} from "./platform/app/reader-contract";
import { hashPath } from "./platform/app/storage";
import { importBook, repairLibraryNames } from "./platform/app/library";
import { migrateBookLive } from "./platform/app/migrate";
import type { Fulltext } from "./fulltext";
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
  createBookThread,
  createThread,
  deleteThread,
  getBookThread,
  getThread,
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
import { locateQuote, type Citation } from "./reading/prep";
import { usePrep } from "./reading/prep/use-prep";
import { useNotes } from "./reading/notes/use-notes";
import InfoHome, { type HomeScreen } from "./ui/components/info/InfoHome";
import { startDistillSweeps, toDistillAnnotations, type DistillAnnotation } from "./observation";
import { logEvent } from "./platform/app/events";
import { prewarmPdfiumEngine } from "./reading/engine/engine-singleton";
import EmbedReaderPane from "./reading/engine/EmbedReaderPane";
import { openFailureText } from "./reading/engine/open-failure";
import { CitationContext, FigureContext, type FigureHost } from "./ui/components/markdown/Markdown";
import {
  findFigureById,
  renderFigure,
  type Figure,
  type FiguresIndex,
} from "./reading/figures";
import PrepPanel from "./ui/components/reader/PrepPanel";
import NotesPanel from "./ui/components/reader/NotesPanel";
import ReaderTopBar from "./ui/components/reader/ReaderTopBar";
import AnnotationPopup from "./ui/components/reader/AnnotationPopup";
import CallBubble from "./ui/components/chat/CallBubble";
import CallView from "./ui/components/chat/CallView";
import ReadingPipCard from "./ui/components/chat/ReadingPipCard";
import ChatPipCard from "./ui/components/chat/ChatPipCard";
import SettingsView from "./ui/components/SettingsView";
import type { CallRow } from "./reading/call-state";
import { closeBook } from "./reading/session/close-book";
import { useCall } from "./reading/session/use-call";
import { openBook } from "./reading/session/open-book";
import { resolveBookSource } from "./reading/session/open-file";
import type { ReaderShell } from "./reading/session/shell";
import { SHELF_PULL_ROUTE } from "./reading/pull-routes";
import { keepReadingPosition, setReadingModes } from "./reading/reading-position";
import { Button } from "./ui/components/ui/button";
import { OVERLAY_Z } from "./ui/components/ui/overlay";
import LibraryScreen from "./ui/components/library/LibraryScreen";
import Toast, { useToasts } from "./ui/components/common/Toast";
import SettingsButton from "./ui/components/common/SettingsButton";
import { useShellBootstrap } from "./ui/components/common/useShellBootstrap";
import type { Annotation as PopupAnnotation, ToolType } from "./ui/components/reader/types";
import type { PendingImage } from "./ui/components/chat/types";
import { rehydrateMessage, type ChatPart } from "./ui/components/chat/chatParts";
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
  const [toolType, setToolType] = useState<ToolType>("none");
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

  // Classroom mode and lesson prep (docs/09): the panel's state and every
  // callback that serves it. Called here so its two effects — the classroom
  // mirror and the scheduler following the reader — keep firing among the
  // shell's own, and it reads the open book through the shell's refs.
  const {
    snapshot: prepSnap,
    panel: prepPanelProps,
    classroomOn,
    classroomRef,
    pipelineRef,
    setSelectedSlug: setSelectedPrepSlug,
    setClassroom,
    reset: resetPrep,
    resume: resumePrep,
  } = usePrep({
    stats,
    bookIdRef,
    ctxRef,
    currentFulltextRef,
    pushToast,
  });

  // One press of the classroom toggle. Persisted immediately rather than on the
  // debounced position save, so the mode survives a book that is closed without
  // the reader scrolling again.
  const toggleClassroom = useCallback(() => {
    const on = !classroomRef.current;
    setClassroom(on);
    const bookId = bookIdRef.current;
    if (!bookId) return;
    setReadingModes(bookId, { classroom: on });
  }, [classroomRef, setClassroom]);

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
    void initSync("desktop").catch((e) => console.warn("sync init failed", e));
    return registerPullRoute({
      ...SHELF_PULL_ROUTE,
      onPulled: () => {
        refreshTopics().catch(() => {});
      },
    });
  }, [refreshTopics]);

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

  // Whether a finger may mark the page. Applied alongside the tool, and again
  // whenever the setting changes, so the reader never routes a finger by a stale
  // copy of it.
  useEffect(() => {
    if (!viewReady) return;
    viewRef.current?.setFingerDraw(fingerDraw);
  }, [fingerDraw, viewReady]);

  // The reader moved. The debounce, the flush on the way out and the failure
  // that must not be silent (pitfall 09) are all reading-position.ts's; the
  // sticky classroom flag (docs/09) rides along with the position, which the
  // reader itself never carries.
  const persist = useCallback((state: ViewState) => {
    const bookId = bookIdRef.current;
    if (!bookId) return;
    keepReadingPosition(bookId, state, { classroom: classroomRef.current });
  }, [classroomRef]);

  const syncTraceList = useCallback(() => {
    setTraceAnns([...annsRef.current.values()]);
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

  // The conversation about the book (docs/03): the open call, the turns running
  // on its threads, the images staged for its next send, and every way in and
  // out of it. Two shapes stay this file's — a chat row, whose parts are the
  // render layer's protocol, and a staged image — so the session is handed the
  // four one-line constructors below instead of the types.
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
    openThread: openThreadCall,
    pendingImages,
    removePendingImage,
    retry: retryCall,
    send: sendCallMessage,
    showChat: showChatMain,
    showReading: swapToReading,
    stageImage,
    stop: stopTurn,
  } = useCall<CallMessage, PendingImage>({
    annsRef,
    bookIdRef,
    bufferRef,
    classroomRef,
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
    maxImages: MAX_PENDING_IMAGES,
    imageLimitHint: `You can attach up to ${MAX_PENDING_IMAGES} images.`,
    loadingImage: (id) => ({ id, status: "loading" }),
    readyImage: (id, image) => ({ id, status: "ready", data: image.data, mediaType: image.mediaType }),
    sendableImages: (staged) =>
      staged.some((p) => p.status === "loading")
        ? null
        : staged.flatMap((p) => (p.status === "ready" ? [{ data: p.data, mediaType: p.mediaType }] : [])),
  });

  // Pay down whatever the observations still owe, on a timer and whenever the
  // app comes back (src/observation/arrears.ts). Silent throughout: a sweep that
  // finds nothing owed does nothing, and one that runs a pass shows no UI. The
  // predicate keeps it off a thread whose reply is still being written.
  useEffect(() => startDistillSweeps((threadId) => isAnswering(threadId)), [isAnswering]);

  // Conversation-start events: whenever a call opens on a thread it wasn't
  // already logged for (fresh mark, reopened mark, thread switch).
  useEffect(() => {
    const id = call?.threadId ?? null;
    if (id && id !== lastCallThreadRef.current) {
      const topicId = ctxRef.current.topicId;
      if (topicId) logEvent(topicId, "call-start", { threadId: id, book: call?.isBook ?? false });
    }
    lastCallThreadRef.current = id;
  }, [call?.threadId, call?.isBook]);

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
      const fig = findFigureById(figuresRef.current, c.id);
      if (fig) viewRef.current?.navigate({ pageIndex: fig.page - 1 });
    } else {
      setSelectedPrepSlug(c.slug);
      setSidebarTab("prep");
      setSidebarOpen(true);
    }
    // Chat covering the reader has to get out of the way of the page it just
    // jumped to. A citation tapped in the bubble covers nothing, so it stays.
    swapToReading();
  }, [jumpToQuote, swapToReading, setSelectedPrepSlug]);

  // AI observations are a topic-level thing and show in the topic's sidebar
  // (ui/components/library/topic/ObservationSection.tsx, docs/31); the reader has
  // no copy of them. What is left here is the panel's old refresh signal, which
  // the topic panel subscribes to itself.

  // The book-notes feature (docs/14): the panel's state and every callback that
  // serves it. It reads the open book through the shell's refs, so what it
  // returns is stable the way it was when this code sat here.
  const {
    snapshot: notesSnap,
    panel: notesPanelProps,
    scheduleAuto: scheduleAutoNotes,
    reset: resetNotes,
    resume: resumeNotes,
    finalPass: finalPassNotes,
  } = useNotes({
    bookIdRef,
    ctxRef,
    settingsRef,
    currentFulltextRef,
    currentFiguresRef,
    bufferRef,
    annsRef,
    pushToast,
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
      // A new mark is the only signal for highlight-driven notes (docs/14): page
      // navigation is not, so the frontier only ever advances on a fresh mark.
      if (newMark) scheduleAutoNotes();

      if (aiCreated) {
        // Persist the aiThreadId into the engine model, open the thread + bubble.
        viewRef.current?.setAnnotations([aiCreated.annotation]);
        const bookId = bookIdRef.current;
        if (bookId) createThread(bookId, aiCreated.annotation.id, aiCreated.threadId);
        const up = penUpRef.current;
        const rect = readerPaneRef.current?.getBoundingClientRect();
        const anchor = up
          ? { x: up.x, y: up.y }
          : { x: (rect?.left ?? 0) + (rect?.width ?? 480) / 2, y: (rect?.top ?? 0) + 240 };
        setPopup(null);
        // A brand-new thread has nothing stored, so opening it is what starts
        // the explanation (docs/03).
        openThreadCall(
          {
            threadId: aiCreated.threadId,
            annotationId: aiCreated.annotation.id,
            view: "bubble",
            anchor,
          },
          [],
        );
      }
    },
    [persistAnnotations, syncTraceList, openThreadCall, scheduleAutoNotes],
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
    const threadId = ann.aiThreadId as string | undefined;
    if (threadId) {
      const bookId = bookIdRef.current;
      const thread = bookId ? getThread(bookId, threadId) : undefined;
      setPopup(null);
      openThreadCall({ threadId, annotationId: ann.id, view: "bubble", anchor }, thread?.messages ?? []);
    } else {
      setPopup({ annotation: ann, anchor });
    }
  }, [openThreadCall]);

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
      resetTool: () => setToolType("none"),
      showMarks: (marks) => {
        annsRef.current = new Map(marks.map((a) => [a.id, a]));
        setTraceAnns(marks);
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
      resetNotes,
      resumeNotes,
      finalPassNotes,
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
      finalPassNotes,
      pushToast,
      resetNotes,
      resetPrep,
      resumeNotes,
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
      viewRef.current?.setAnnotations([updated]);
      persistAnnotations();
      syncTraceList();
      setPopup((p) => (p && p.annotation.id === id ? { ...p, annotation: updated } : p));
    },
    [persistAnnotations, syncTraceList],
  );

  // Trace-list click: jump to the mark. Programmatic select does not open the
  // popup (pitfall 04), which is what we want for a list jump.
  const onTraceSelect = useCallback((id: string) => {
    // Same as the outline jump: leaving the drawer open parks its backdrop over
    // the page we just navigated to, and the backdrop only answers a tap.
    setSidebarOpen(false);
    viewRef.current?.selectAnnotations([id]);
    viewRef.current?.navigate({ annotationID: id });
    setSelectedAnnId(id);
  }, []);

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
  // is the same pairing the ✕'s delete already makes from the other end. The
  // mark goes through removeAnnotation like every other deletion, so the
  // annotations file, the in-memory map and sync stay in agreement; the thread
  // goes through deleteThread, an in-file rewrite its own cache owns. What was
  // distilled from the talk stays, and the event log is appended to, not
  // rewritten.
  const deleteTraceAnnotation = useCallback(
    (id: string) => {
      const bookId = bookIdRef.current;
      const threadId = annsRef.current.get(id)?.aiThreadId as string | undefined;
      dropThread(id, threadId);
      if (bookId && threadId && deleteThread(bookId, threadId)) {
        const topicId = ctxRef.current.topicId;
        if (topicId) logEvent(topicId, "thread-delete", { threadId, book: false });
      }
      removeAnnotation(id);
    },
    [dropThread, removeAnnotation],
  );

  const openThreadForAnnotation = useCallback(
    (annotationId: string) => {
      const ann = annsRef.current.get(annotationId);
      const threadId = ann?.aiThreadId as string | undefined;
      const bookId = bookIdRef.current;
      if (!threadId || !bookId) return;
      const thread = getThread(bookId, threadId);
      viewRef.current?.selectAnnotations([annotationId]);
      viewRef.current?.navigate({ annotationID: annotationId });
      setSelectedAnnId(annotationId);
      openThreadCall(
        { threadId, annotationId, view: "chat-main", anchor: { x: 0, y: 0 } },
        thread?.messages ?? [],
      );
    },
    [openThreadCall],
  );

  // Top-bar AI button: the selection-free entry (docs/03). One persistent
  // book-level thread per book — created on first press, reopened with its
  // history on later presses (and after hangup), the way a mark hosts its
  // thread. It has no anchor, so it never joins the trace list; this button is
  // its only way back. Opens straight to the main call view, skipping the bubble.
  const openBookThread = useCallback(() => {
    const bookId = bookIdRef.current;
    if (!bookId) return;
    const thread = getBookThread(bookId) ?? createBookThread(bookId, crypto.randomUUID());
    setPopup(null);
    openThreadCall(
      {
        threadId: thread.id,
        annotationId: "",
        isBook: true,
        view: "chat-main",
        anchor: { x: 0, y: 0 },
      },
      thread.messages,
    );
  }, [openThreadCall]);

  // Jump the reading back to the thread's mark (from the reading corner card).
  // The book-level thread has no mark, so there is nothing to jump to.
  const onPositionClick = useCallback(() => {
    const c = currentCall();
    if (!c || !c.annotationId) return;
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

  // Escape closes whatever is topmost (Settings, else the open call — same path
  // as the hang-up button, else the annotation popup); Ctrl/Cmd+\ toggles the
  // sidebar. Escape works even while a composer has focus; the sidebar toggle is
  // ignored while typing so it doesn't fight text input. The session's own
  // reference to the open call (not `call`) keeps this listener stable across a
  // streaming reply's frequent state churn.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === "Escape") {
        if (showSettings) setShowSettings(false);
        else if (quoteHlActive) viewRef.current?.clearQuoteHighlight();
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
  }, [showSettings, popup, endCall, currentCall, quoteHlActive, sidebarOpen]);

  // Background work the drawer would show if open (prep/notes generation): the
  // toggle carries a status dot so progress is visible while the drawer is shut.
  const sidebarBusy = !!(prepSnap?.running || notesSnap?.running);

  const inReader = !!title;
  const showGuidance = call?.view === "bubble" && call.messages.length === 0 && !configured;
  const lastCallMsg = call?.messages[call.messages.length - 1];
  const streaming = !!(lastCallMsg?.role === "ai" && lastCallMsg.streaming);

  // One-line prep status beside the Classroom toggle.
  const prepStatusLine = (() => {
    const s = prepSnap?.state;
    if (!s) return classroomOn ? "Starting prep…" : null;
    if (s.planStatus === "pending" || s.planStatus === "running") return "Reading the references…";
    if (s.planStatus === "failed") return "Prep failed — see the prep panel";
    const ready = s.papers.filter((p) => p.status === "done" || p.status === "abstract-only").length;
    return `${ready}/${s.papers.length} papers ready`;
  })();

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

  return (
    <CardRegistryProvider>
    <CitationContext.Provider value={onCitation}>
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
              setToolType(t.type);
              setPenColor(t.color);
            }}
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
              if (t === "notes" && activeTopic) logEvent(activeTopic.id, "notes-tab-open");
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
            onSelectAnnotation={onTraceSelect}
            onDeleteAnnotation={deleteTraceAnnotation}
            onOpenThread={openThreadForAnnotation}
            prepPanel={<PrepPanel {...prepPanelProps} />}
            notesPanel={<NotesPanel {...notesPanelProps} />}
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
            onSend={sendCallMessage}
            onExpand={showChatMain}
            onClose={endCall}
            onDelete={deleteOpenThread}
            pendingImages={pendingImages}
            onRemoveImage={removePendingImage}
            hint={imageHint}
            streaming={streaming}
            onStop={stopTurn}
            voice={callVoice}
          />
        )}

        {/* No provider configured: guide to Settings instead of chatting. */}
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
                onSend={sendCallMessage}
                onHangUp={endCall}
                onDelete={deleteOpenThread}
                pendingImages={pendingImages}
                onRemoveImage={removePendingImage}
                hint={imageHint}
                streaming={streaming}
                onStop={stopTurn}
                classroomOn={classroomOn}
                onToggleClassroom={toggleClassroom}
                classroomStatus={prepStatusLine}
                emptyTitle={call.isBook ? title ?? "This book" : undefined}
                placeholder={call.isBook ? "Ask about this book…" : undefined}
                voice={callVoice}
              />
            </div>
            <div className="absolute right-3 top-3 z-50">
              {(() => {
                const excerpt = callExcerpt(annsRef.current.get(call.annotationId)) || null;
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
              lastMessage={call.messages.length ? call.messages[call.messages.length - 1].text : null}
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
    </CitationContext.Provider>
    </CardRegistryProvider>
  );
}

function callExcerpt(ann: Annotation | undefined): string {
  if (!ann) return "";
  if (typeof ann.text === "string" && ann.text) return ann.text;
  if (typeof ann.comment === "string" && ann.comment) return ann.comment;
  return "";
}
