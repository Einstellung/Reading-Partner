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
import { getViewState, hashPath } from "./platform/app/storage";
import {
  importBook,
  libraryHas,
  readLibraryBook,
  repairLibraryNames,
} from "./platform/app/library";
import { migrateBookLive } from "./platform/app/migrate";
import { ensureFulltext, type Fulltext } from "./fulltext";
import Sidebar, { type SidebarTab } from "./ui/components/reader/Sidebar";
import { annotationPage, toolStatusLabel } from "./reading/context";
import {
  ANNOTATION_COLORS,
  deleteAnnotations,
  loadAnnotations,
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
  appendMessage,
  createBookThread,
  createThread,
  deleteThread,
  getBookThread,
  getThread,
  loadThreads,
  readThreadImages,
  saveThreadImages,
  type ThreadMessage,
} from "./platform/app/threads";
import { initSync } from "./platform/sync";
import { registerPullRoute } from "./platform/sync/pull-routes";
import { compressImage, compressImageData, type CompressedImage } from "./ai/image-utils";
import { readClipboardImage } from "./platform/app/clipboard";
import { isTauri } from "./platform/app/host";
import { DEFAULT_SETTINGS, toReasoning, type Settings } from "./platform/app/settings";
import { buildGlossary } from "./ai/voice";
import {
  modelSupportsImages,
  runAgentTurn,
  type ProviderId,
} from "./ai/aiClient";
import { locateQuote, type Citation } from "./reading/prep";
import { usePrep } from "./reading/prep/use-prep";
import { useNotes } from "./reading/notes/use-notes";
import InfoHome, { type HomeScreen } from "./ui/components/info/InfoHome";
import {
  distillThread,
  startDistillSweeps,
  sweepDistillation,
  toDistillAnnotations,
  type DistillAnnotation,
} from "./observation";
import { logEvent } from "./platform/app/events";
import { prewarmPdfiumEngine } from "./reading/engine/engine-singleton";
import EmbedReaderPane from "./reading/engine/EmbedReaderPane";
import { openFailureText } from "./reading/engine/open-failure";
import { CitationContext, FigureContext, type FigureHost } from "./ui/components/markdown/Markdown";
import {
  clearFigureCache,
  ensureFigures,
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
import { backgroundFailureToast, buildReadingTurn, turnFailureView, type TurnFailure } from "./reading/turn";
import { createLiveTurns, type LiveTurn } from "./reading/live-turns";
import { createPendingImages } from "./reading/pending-images";
import { SHELF_PULL_ROUTE } from "./reading/pull-routes";
import {
  keepReadingPosition,
  seedReadingPosition,
  setReadingModes,
} from "./reading/reading-position";
import { researchStatusLabel, RESEARCH_TOOL_NAME } from "./reading/papers/research-agent";
import type { SubagentProgress } from "./ai/subagent";
import { Button } from "./ui/components/ui/button";
import { OVERLAY_Z } from "./ui/components/ui/overlay";
import { appendRunningTool, relabelRunningTool, resolveToolStatus } from "./ai/tool-status";
import LibraryScreen from "./ui/components/library/LibraryScreen";
import Toast, { useToasts } from "./ui/components/common/Toast";
import SettingsButton from "./ui/components/common/SettingsButton";
import { useShellBootstrap } from "./ui/components/common/useShellBootstrap";
import type { Annotation as PopupAnnotation, ToolType } from "./ui/components/reader/types";
import type { PendingImage } from "./ui/components/chat/types";
import type { ToolStatus } from "./ai/tool-status";
import { rehydrateMessage, type ChatPart } from "./ui/components/chat/chatParts";
import { CardRegistryContext } from "./ui/components/chat/cardRegistryContext";
import { CARD_REGISTRY } from "./ui/components/cardRegistry";
import { holdsNoAnswer, refusalRow } from "./ui/components/chat/turn-rows";
import { refreshInfoCollector } from "./info/briefing/live";

// The AI pen maps to the engine's underline tool in a fixed purple (the palette's
// Purple). Owning this one color for the AI pen is a v1 implementation
// convenience, not a semantic in the color palette; the host identifies AI-pen
// strokes by the active tool, not the color.
const AI_PEN_COLOR = "#a28ae5";
// Cap on images attached to one chat turn (docs/03: paste screenshots to ask).
// Per conversation, like the staging list itself.
const MAX_PENDING_IMAGES = 3;
// What the composer renders with no call open. A constant, so hanging up twice
// does not hand React a second empty array.
const NO_PENDING_IMAGES: PendingImage[] = [];

// Reading layout for a book that has never chosen one: vertical continuous
// scroll on every surface (the correct PDF-reading default; a finger swipe
// scrolls, like Notability / PDF Expert). Paged horizontal flip stays available
// as an opt-in in the reader's More menu, off by default.
const DEFAULT_LAYOUT = "vertical" as const;

interface PopupState {
  annotation: Annotation;
  anchor: { x: number; y: number };
}

// Display message. Unlike the persisted ThreadMessage (which stores images as
// on-disk filenames), the display form carries the image bytes as base64 so a
// bubble can render them directly; App loads them from disk on thread open.
type CallMessage = {
  role: "user" | "ai";
  text: string;
  ts: number;
  images?: CompressedImage[];
  streaming?: boolean;
  failed?: boolean;
  // The durable parts of the row (chatParts.ts). Present on rows that carry a
  // card — a recorded rehearsal decision — and absent on plain prose, which
  // renders from `text`.
  parts?: ChatPart[];
  // Transient tool-call trace for a streaming AI turn (M6); never persisted.
  tools?: ToolStatus[];
  // What the turn left out to fit the context window (src/budget). Display-only,
  // like the trace: it is the app's remark about the turn, not model output.
  notice?: string;
};

// Persisted thread messages -> display messages. Image bytes are loaded
// separately (hydrateThreadImages), so images start absent here. Stored parts
// come back as render parts (rehydrateMessage), so a rehearsal decision card is
// still there when the conversation is reopened days later.
function toDisplayMessages(msgs: ThreadMessage[]): CallMessage[] {
  return msgs.map(rehydrateMessage);
}

// A live AI "call" — one thread anchored on one AI-pen underline (docs/03).
interface CallState {
  threadId: string;
  // The AI-pen mark hosting this call. Empty string for the book-level thread
  // (docs/03: top-bar AI button), flagged by `isBook`.
  annotationId: string;
  isBook?: boolean;
  // Picture-in-picture call states (docs/03): the bubble, chat taking the whole
  // window (reading shrunk to a corner card), and reading with chat shrunk to a
  // corner card. `null` call = no active call.
  view: "bubble" | "chat-main" | "chat-pip";
  anchor: { x: number; y: number };
  messages: CallMessage[];
  error?: boolean; // last turn failed (offer retry)
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
  // Current call view, mirrored for the reader pane's pointerdown handler
  // (which can't read React state directly).
  const callViewRef = useRef<"none" | "bubble" | "chat-main" | "chat-pip">("none");
  // Last pen-lift position over the reader pane (viewport coordinates) — the
  // AI-pen bubble anchor, since drawing a pen stroke yields no popup coordinates.
  const penUpRef = useRef<{ x: number; y: number } | null>(null);
  // Turns still streaming, one per thread (reading/live-turns). Closing a bubble
  // leaves its turn running; only a deleted thread or a closed book cuts one off.
  const liveTurnsRef = useRef(createLiveTurns<CallMessage>());
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
  // Refs read by the stable runTurn callback (avoids dependency churn).
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

  const [topics, setTopics] = useState<Topic[]>([]);
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
  const [call, setCall] = useState<CallState | null>(null);
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
    syncReport,
  } = useShellBootstrap({ settingsOpen: showSettings, pushToast });
  const fingerDraw = !!device?.fingerDraw;

  // Images pasted into the composer, awaiting send: a placeholder appears while
  // the async compression runs, then resolves to a ready preview. A single
  // document-level paste listener fills these; the composer only renders them.
  // The store keys them by thread (src/reading/pending-images) so an unsent image
  // stays on its own conversation, and holding it in a ref keeps bursts of pastes
  // and the stable send handler on the current list without waiting for a
  // re-render. The two states below are only what the open thread renders.
  const pendingRef = useRef(createPendingImages<PendingImage>(MAX_PENDING_IMAGES));
  const [pendingImages, setPendingImages] = useState<PendingImage[]>(NO_PENDING_IMAGES);
  // Inline note under the composer when a paste is rejected (model can't see it).
  const [imageHint, setImageHint] = useState("");

  // Mirror the call (view for the pdf listener, whole thing for send handlers).
  const callRef = useRef<CallState | null>(null);
  useEffect(() => {
    callViewRef.current = call?.view ?? "none";
    callRef.current = call;
    // The composer shows the open conversation's own staging, and nothing when
    // no call is open. This runs on every call change, so switching threads and
    // hanging up both land here; the store hands back the same list identity
    // when nothing moved, so a streamed token does not re-render the composer.
    setPendingImages(call ? pendingRef.current.images(call.threadId) : NO_PENDING_IMAGES);
    setImageHint(call ? pendingRef.current.hint(call.threadId) : "");
  }, [call]);

  // Prewarm the PDFium engine so the wasm is compiled before the first book
  // open, not on its critical path.
  useEffect(() => {
    prewarmPdfiumEngine();
  }, []);

  // Pay down whatever the observations still owe, on a timer and whenever the
  // app comes back (src/observation/arrears.ts). Silent throughout: a sweep that
  // finds nothing owed does nothing, and one that runs a pass shows no UI. The
  // predicate keeps it off a thread whose reply is still being written.
  useEffect(() => startDistillSweeps((threadId) => liveTurnsRef.current.has(threadId)), []);

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
    () => topics.find((t) => t.id === activeTopicId) ?? null,
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
    refreshTopics().catch(() => {});
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

  // Load a thread's stored images (filenames -> base64) and patch them into the
  // open call so the bubbles show them. Async so opening a thread stays instant.
  const hydrateThreadImages = useCallback((threadId: string, msgs: ThreadMessage[]) => {
    const withImages = msgs.filter((m) => m.images && m.images.length > 0);
    if (withImages.length === 0) return;
    void (async () => {
      const loaded = new Map<number, CompressedImage[]>();
      for (const m of withImages) {
        loaded.set(m.ts, await readThreadImages(threadId, m.images as string[]));
      }
      setCall((c) =>
        c && c.threadId === threadId
          ? {
              ...c,
              messages: c.messages.map((m) => (loaded.has(m.ts) ? { ...m, images: loaded.get(m.ts) } : m)),
            }
          : c,
      );
    })();
  }, []);

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
    setCall((cur) => (cur && cur.view === "chat-main" ? { ...cur, view: "chat-pip" } : cur));
  }, [jumpToQuote]);

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

  // The open book's marks for distillation's silent-marks input (docs/02 part 2):
  // id, page, selected text, note, and creation time (from the engine's ISO
  // dateCreated) so the "since last distillation" filter can work.
  const distillAnnotations = useCallback((): DistillAnnotation[] => {
    return toDistillAnnotations([...annsRef.current.values()]);
  }, []);

  // Thread history the way an opening view shows it: what the file holds, plus
  // the reply still being written if that thread has a turn running. Reopening a
  // mark mid-answer joins the stream where it is, instead of showing nothing
  // until the answer lands.
  const openMessages = useCallback(
    (threadId: string, msgs: ThreadMessage[]) =>
      liveTurnsRef.current.withLive(threadId, toDisplayMessages(msgs)),
    [],
  );

  // Whether opening this thread should start the explanation itself: an empty
  // thread that is not already being answered in the background.
  const needsFirstTurn = useCallback(
    (threadId: string, msgs: ThreadMessage[]) => msgs.length === 0 && !liveTurnsRef.current.has(threadId),
    [],
  );

  // Run one assistant turn for a thread: assemble the reading context, stream the
  // reply into the bubble, persist on done. Stable (reads refs). No-ops (leaving
  // the bubble empty for the guidance) when no provider is configured.
  //
  // The turn belongs to its thread, not to the view: closing the bubble leaves it
  // running (docs/03) and every callback below writes through liveTurns, so the
  // row survives a bubble that stopped re-rendering.
  const runTurn = useCallback((threadId: string, annotationId: string) => {
    const bookId = bookIdRef.current;
    const s = settingsRef.current;
    if (!bookId || !s.defaultProviderId || !s.defaultModelId) return;
    const liveTurns = liveTurnsRef.current;
    const controller = new AbortController();

    const patch = (
      fn: (m: CallMessage) => CallMessage,
      ts: number,
      error?: boolean,
    ) => {
      liveTurns.patch(threadId, ts, fn);
      setCall((c) =>
        !c || c.threadId !== threadId
          ? c
          : {
              ...c,
              error: error ?? c.error,
              messages: c.messages.map((m) => (m.ts === ts && m.role === "ai" ? fn(m) : m)),
            },
      );
    };

    // Push a running tool status onto the streaming reply; clearing any partial
    // text discards inter-round preamble so only the final answer shows (M6).
    const onToolStart = (info: { name: string; args: Record<string, any> }, ts: number) => {
      patch(
        (m) => ({
          ...m,
          text: "",
          tools: appendRunningTool(m.tools, info.name, toolStatusLabel(info.name, info.args)),
        }),
        ts,
      );
    };
    const onToolEnd = (info: { name: string; isError: boolean }, ts: number) =>
      patch((m) => {
        const tools = resolveToolStatus(m.tools, info.name, info.isError);
        return tools ? { ...m, tools } : m;
      }, ts);

    // A research sub-agent run, in the row the reader already has for the tool call
    // that started it (docs/25). One line, rewritten in place: not the sub-agent's
    // own tool calls, not its queries, not what it read.
    const onSubagentProgress = (progress: SubagentProgress, ts: number) =>
      patch((m) => {
        const tools = relabelRunningTool(
          m.tools,
          RESEARCH_TOOL_NAME,
          researchStatusLabel(progress),
        );
        return tools ? { ...m, tools } : m;
      }, ts);

    // A turn that ends without a reply. The row it leaves behind, whether a
    // toast goes up and whether Retry is offered all follow from which kind it
    // was (reading/turn.ts), so the refusal paths cannot pick up the error
    // path's red banner or its "couldn't reach the model".
    //
    // With the conversation closed there is no row to leave behind and no Retry
    // to press: the toast carries the whole failure, for every kind. The turn is
    // then gone — reopening the mark shows the thread as it was, and asking
    // again is the way back.
    const showFailure = (kind: TurnFailure, message: string, ts: number) => {
      const live = liveTurns.settle(threadId, controller);
      if (controller.signal.aborted) return; // deleted thread / closed book, not a failure
      const view = turnFailureView(kind, message);
      if (callRef.current?.threadId === threadId) {
        if (view.toast) pushToast("error", view.toast);
        patch(
          (m) =>
            view.as === "notice"
              ? { ...m, ...refusalRow(m, view.text) }
              : { role: "ai", text: view.text, ts, failed: true },
          ts,
          view.retry,
        );
      } else {
        const marked = annsRef.current.get(annotationId)?.text;
        pushToast("error", backgroundFailureToast(kind, typeof marked === "string" ? marked : ""));
      }
      live?.onSettled?.();
    };

    const ann = annsRef.current.get(annotationId);
    const ts = Date.now();
    const streamingRow: CallMessage = { role: "ai", text: "", ts, streaming: true };
    liveTurns.start({ threadId, bookId, controller, message: streamingRow });
    setCall((c) => {
      if (!c || c.threadId !== threadId) return c;
      const kept = c.messages.filter((m) => !holdsNoAnswer(m));
      return { ...c, error: false, messages: [...kept, streamingRow] };
    });

    void (async () => {
      // Assemble the live reading context and topic-scoped tools (M6). The
      // current book's extraction may still be running; await it so the AI can
      // see the page. Thread images (stored as filenames) are read back too.
      const currentFulltext = (await currentFulltextRef.current) ?? null;
      const figures = (await currentFiguresRef.current)?.figures ?? [];
      const turn = await buildReadingTurn({
        bookId,
        threadId,
        annotationId,
        annotation: ann,
        annotations: [...annsRef.current.values()],
        fulltext: currentFulltext,
        figures,
        buffer: bufferRef.current,
        context: ctxRef.current,
        classroom: classroomRef.current,
        settings: s,
        getPipeline: () => pipelineRef.current,
        distillAnnotations,
        signal: controller.signal,
        onSubagentProgress: (progress) => onSubagentProgress(progress, ts),
      });
      if (!turn) {
        liveTurns.settle(threadId, controller); // aborted while reading history
        return;
      }
      // The turn could not be assembled small enough to leave the model room to
      // answer. Say so instead of sending it: an over-full request comes back one
      // token long with a normal `done` and no error (docs/pitfall/65), which
      // reads as a one-word reply. No Retry offered — the same inputs assemble
      // the same call, so there is nothing for a second press to change.
      if (turn.refusal) {
        showFailure("refusal", turn.refusal, ts);
        return;
      }

      void runAgentTurn({
        providerId: s.defaultProviderId as ProviderId,
        modelId: s.defaultModelId as string,
        systemPrompt: turn.systemPrompt,
        messages: turn.messages,
        tools: turn.tools,
        signal: controller.signal,
        reasoning: toReasoning(s.chatThinking),
        onDelta: (chunk) => {
          patch((m) => ({ ...m, text: m.text + chunk }), ts);
        },
        onToolStart: (info) => onToolStart(info, ts),
        onToolEnd: (info) => onToolEnd(info, ts),
        onDone: (full) => {
          const live = liveTurns.settle(threadId, controller);
          if (controller.signal.aborted) return; // stopTurn already kept the partial
          // The notice rides the displayed row only. Persisting it would replay it
          // next turn as if the model had written it, and it would then describe a
          // turn whose assembly no longer applies.
          patch(
            (m) => ({
              role: "ai",
              text: full,
              ts,
              tools: (m.tools ?? []).filter((t) => t.state === "error"),
              ...(turn.notice ? { notice: turn.notice } : {}),
            }),
            ts,
          );
          appendMessage(bookId, threadId, { role: "ai", text: full, ts });
          // A hangup that happened mid-answer waited for this (see captureHangup):
          // distillation reads the thread file, which only now holds the reply.
          live?.onSettled?.();
        },
        onError: (message: string) => {
          if (!controller.signal.aborted) console.error("agent turn failed", message);
          showFailure("error", message, ts);
        },
        // The loop gave up mid-turn: the call outgrew the window, or it spent the
        // round cap fetching without answering. Shown like the refusal above,
        // because that is what it is.
        onRefusal: (message: string) => showFailure("refusal", message, ts),
      });
    })();
  }, [pushToast, distillAnnotations]);

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
        setCall({
          threadId: aiCreated.threadId,
          annotationId: aiCreated.annotation.id,
          view: "bubble",
          anchor,
          messages: [],
        });
        // The bubble starts explaining on its own (docs/03). If no provider is
        // configured, runTurn no-ops and the empty bubble shows the guidance.
        runTurn(aiCreated.threadId, aiCreated.annotation.id);
      }
    },
    [persistAnnotations, syncTraceList, runTurn, scheduleAutoNotes],
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
      const msgs = thread?.messages ?? [];
      setCall({ threadId, annotationId: ann.id, view: "bubble", anchor, messages: openMessages(threadId, msgs) });
      hydrateThreadImages(threadId, msgs);
      // Empty thread (e.g. created before a provider was configured) → explain now.
      if (needsFirstTurn(threadId, msgs)) runTurn(threadId, ann.id);
    } else {
      setPopup({ annotation: ann, anchor });
    }
  }, [runTurn, hydrateThreadImages, openMessages, needsFirstTurn]);

  // The pen stroke gives the host no coordinates, so track the last pen-lift
  // over the reader pane as the AI-pen bubble anchor (capture phase, so nothing
  // inside the engine can swallow it).
  const onPanePointerUp = useCallback((e: React.PointerEvent) => {
    penUpRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  // Hangup bookkeeping (docs/02, docs/03): log the end of the conversation and
  // kick the silent observation distillation over its persisted transcript. Reads
  // refs so it is stable; no-ops when nothing is open. Distillation runs in the
  // background with no UI — the observations panel shows when it last ran. Declared
  // up here because every way out of a call is below and all go through it.
  //
  // Hanging up mid-answer waits: the reply is still being written and the
  // transcript would be a half sentence, so the distillation is handed to the
  // turn and runs when it lands. The event is logged now — it is the hangup that
  // happened now. The marks are read now too: a deferred pass can land after the
  // reader has moved to another book, and annsRef would by then hold that book's
  // marks — the wrong input, and it would push the silent-marks cursor past them.
  const captureHangup = useCallback(() => {
    const c = callRef.current;
    const bookId = bookIdRef.current;
    const { topicId, topicName, fileName, pageIndex } = ctxRef.current;
    if (!c || !bookId || !topicId) return;
    logEvent(topicId, "call-end", { threadId: c.threadId, book: c.isBook ?? false });
    const ann = annsRef.current.get(c.annotationId);
    const annotations = distillAnnotations();
    const distill = () =>
      void distillThread({
        topicId,
        topicName,
        bookId,
        bookName: fileName,
        threadId: c.threadId,
        trigger: "hangup",
        annotationId: c.annotationId,
        // The book-level thread has no mark: pin its position to the current page.
        page: c.isBook
          ? pageIndex !== null
            ? pageIndex + 1
            : null
          : annotationPage(ann as { position?: { pageIndex?: number } } | undefined),
        markedText: c.isBook ? "" : typeof ann?.text === "string" ? ann.text : "",
        messages: (getThread(bookId, c.threadId)?.messages ?? []).map(({ role, text, ts }) => ({ role, text, ts })),
        annotations,
      });
    if (!liveTurnsRef.current.whenSettled(c.threadId, distill)) distill();
  }, [distillAnnotations]);

  // Touching the book dismisses the bubble / chat corner card (docs/03).
  // chat-main is not dismissable this way (CallView covers the reader). AI-pen
  // draws and mark clicks fire this on pointerdown, then re-open on save/select.
  // A reply in flight is no reason to hold the bubble open: it keeps writing and
  // lands in the thread either way.
  //
  // This is a hangup, not a lesser dismissal: the conversation is over either
  // way, so it does the same bookkeeping the ✕ does. On a tablet it is the exit
  // that actually gets used.
  const onPanePointerDown = useCallback(() => {
    if (callViewRef.current === "bubble" || callViewRef.current === "chat-pip") {
      captureHangup();
      setCall(null);
    }
  }, [captureHangup]);

  const openInReader = useCallback(
    async (bookId: string, name: string, bytes: Uint8Array) => {
      setStatus("Rendering…");
      setPopup(null);
      // Leaving a book with a call open ends that conversation, same as closing
      // the reader. First thing in, while the refs the hangup reads still point
      // at the book being left.
      captureHangup();
      // And a look at what the book being left still owes: a stretch of reading
      // with nothing said in it never reaches the hangup path at all.
      void sweepDistillation("book-switch");
      setCall(null);
      // The images staged in this book's conversations go with it, same as
      // closing the reader: they are in memory only, and every thread they
      // belong to is about to be out of reach.
      pendingRef.current.clearAll();
      setSelectedAnnId(null);
      // Every book opens with nothing selected. The tool state lives on App and
      // would otherwise carry the previous book's annotation tool into the next
      // open — a finger then marks the page the moment it lands. The navigation
      // lock is not carried over either; it is a per-session reading posture.
      setToolType("none");
      const state = await getViewState(bookId);
      let saved: Annotation[] = [];
      try {
        saved = await loadAnnotations(bookId);
      } catch (e) {
        console.error("failed to load annotations", e);
        pushToast("warn", "Saved annotations could not be loaded");
      }
      try {
        await loadThreads(bookId);
      } catch (e) {
        console.error("failed to load threads", e);
        pushToast("warn", "Saved AI conversations could not be loaded");
      }
      annsRef.current = new Map(saved.map((a) => [a.id, a]));
      setTraceAnns(saved);

      setViewReady(false);
      bookIdRef.current = bookId;
      bookNameRef.current = name;
      // Seed the persist base with the loaded state so an early mode press
      // (before the reader emits a position) merges onto the right book.
      seedReadingPosition(bookId, state);
      // Dwell tracking restarts per book (never a cross-book page-nav event).
      pageDwellRef.current = null;
      // A restored classroom "on" attaches the pipeline below once the fulltext
      // is ready, degrading exactly like a manual toggle-on when the book has no
      // readable text. The flag is per book and sticky (docs/09); detach the
      // previous book's prep panel first (the pipeline itself keeps running in
      // the background as a module singleton).
      const restoreClassroom = !!state?.classroom;
      resetPrep(restoreClassroom);
      // Notes are per book too; detach the previous book's panel.
      resetNotes();
      // Extract the full text in the background so the AI can see the book
      // (M6). Fire-and-forget: never blocks rendering.
      setFulltextPending(true);
      setFulltext(null);
      // Reset the figure index + cached crops for the new book (M9).
      setFigures([]);
      figuresRef.current = [];
      clearFigureCache();
      // One copy of the book, shared by everything that reads it. pdf.js does
      // detach the buffer it is handed, but every consumer here already slices
      // its own before handing it over (fulltext/extract.ts, figures/store.ts,
      // figures/render.ts, EmbedPdfView's wireEngine), so a copy per consumer
      // was five 26 MB allocations at book-open where one does.
      const buffer = bytes.slice().buffer as ArrayBuffer;
      bufferRef.current = buffer;
      currentFiguresRef.current = ensureFigures(bookId, buffer).catch((e) => {
        console.warn("failed to extract figures", e);
        return null;
      });
      currentFiguresRef.current.then((idx) => {
        if (bookIdRef.current !== bookId) return; // stale: the user switched books
        const list = idx?.figures ?? [];
        figuresRef.current = list;
        setFigures(list);
      });
      currentFulltextRef.current = ensureFulltext(bookId, buffer).catch((e) => {
        console.warn("failed to extract fulltext", e);
        return null;
      });
      currentFulltextRef.current.then(async (ft) => {
        if (bookIdRef.current !== bookId) return; // stale: the user switched books
        setFulltext(ft);
        setFulltextPending(false);
        if (ft && ft.status === "ok") {
          // Resume lesson prep from its persisted state (docs/09).
          await resumePrep(bookId, name, ft, restoreClassroom);
          // Resume book notes from persisted state (docs/14).
          await resumeNotes(bookId, name, ft);
        }
      });

      // Mount EmbedReaderPane with the bytes. It calls back onView (sets
      // viewRef) and onInitialized once ready. It slices its own copy for
      // PDFium and never detaches this one, so it reads the shared buffer.
      setEmbedDoc({
        bookId,
        name,
        buffer,
        annotations: saved,
        // Seed the layout for a book that has never chosen one, so the reader
        // opens in the right mode on the first paint.
        viewState: state
          ? { ...state, layout: state.layout ?? DEFAULT_LAYOUT }
          : ({ pageIndex: 0, scale: "auto", scrollMode: 0, layout: DEFAULT_LAYOUT } as ViewState),
      });
      setTitle(name);
    },
    [pushToast, resetPrep, resumePrep, resetNotes, resumeNotes, captureHangup],
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
        let bytes: Uint8Array;
        let bookId: string;
        if (file.hash && (await libraryHas(file.hash))) {
          bytes = await readLibraryBook(file.hash);
          bookId = file.hash;
        } else {
          bytes = await readFile(file.path);
          const entry = await importBook(bytes, file.path);
          bookId = entry.hash;
          await migrateBookLive(hashPath(file.path), bookId);
          if (file.hash !== bookId) await setFileHash(tid, file.path, bookId);
        }
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
    const recent = mostRecentlyOpened(topics);
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

  // Push a thread's staging into what the composer renders. Every write goes
  // through here, and a write to a thread that is not the one on screen (a
  // compression landing after the user moved on) only updates the store.
  const showPending = useCallback((threadId: string) => {
    if (callRef.current?.threadId !== threadId) return;
    setPendingImages(pendingRef.current.images(threadId));
    setImageHint(pendingRef.current.hint(threadId));
  }, []);

  const noteImageHint = useCallback(
    (threadId: string, hint: string) => {
      pendingRef.current.setHint(threadId, hint);
      showPending(threadId);
    },
    [showPending],
  );

  // Stage an image for the next send on one thread: a placeholder shows
  // immediately, the async compression runs, then the ready preview swaps in (or
  // it's dropped + a hint on failure). Capped at MAX_PENDING_IMAGES per thread.
  const stageImage = useCallback(
    (threadId: string, produce: () => Promise<CompressedImage>) => {
      const pending = pendingRef.current;
      const id = crypto.randomUUID();
      if (!pending.add(threadId, { id, status: "loading" })) {
        noteImageHint(threadId, `You can attach up to ${MAX_PENDING_IMAGES} images.`);
        return;
      }
      showPending(threadId);
      produce().then(
        (img) => {
          pending.replace(threadId, id, { id, status: "ready", data: img.data, mediaType: img.mediaType });
          showPending(threadId);
        },
        (e) => {
          console.error("failed to process pasted image", e);
          pending.remove(threadId, id);
          noteImageHint(threadId, e instanceof Error ? e.message : "Couldn't process that image");
        },
      );
    },
    [showPending, noteImageHint],
  );

  const removePendingImage = useCallback(
    (id: string) => {
      const threadId = callRef.current?.threadId;
      if (!threadId) return;
      pendingRef.current.remove(threadId, id);
      showPending(threadId);
    },
    [showPending],
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

  // Sending appends the user line (with any ready staged images, persisted to
  // disk) then streams the reply. Empty text with images is allowed; images
  // still compressing block the send (the composer disables it too).
  const sendCallMessage = useCallback(
    (text: string) => {
      const c = callRef.current;
      const bookId = bookIdRef.current;
      if (!c || !bookId) return;
      const pending = pendingRef.current;
      const staged = pending.images(c.threadId);
      const trimmed = text.trim();
      if (staged.some((p) => p.status === "loading")) return; // wait for compression
      const images = staged.flatMap((p) =>
        p.status === "ready" ? [{ data: p.data, mediaType: p.mediaType }] : [],
      );
      if (!trimmed && images.length === 0) return;
      const ts = Date.now();
      // Only this conversation's staging goes; another thread's images are still
      // waiting for their own send.
      pending.take(c.threadId);
      showPending(c.threadId);
      void (async () => {
        let imageNames: string[] = [];
        if (images.length > 0) {
          try {
            imageNames = await saveThreadImages(c.threadId, images);
          } catch (e) {
            console.error("failed to persist pasted images", e);
            pushToast("warn", "Pasted image could not be saved");
            pending.restore(c.threadId, staged); // give them back so the send can be retried
            showPending(c.threadId);
            return;
          }
        }
        // Persist filenames; display the base64 we already have in hand.
        const persistMsg: ThreadMessage = {
          role: "user",
          text: trimmed,
          ts,
          ...(imageNames.length ? { images: imageNames } : {}),
        };
        appendMessage(bookId, c.threadId, persistMsg);
        const displayMsg: CallMessage = {
          role: "user",
          text: trimmed,
          ts,
          ...(images.length ? { images } : {}),
        };
        setCall((cur) =>
          cur && cur.threadId === c.threadId ? { ...cur, messages: [...cur.messages, displayMsg] } : cur,
        );
        runTurn(c.threadId, c.annotationId);
      })();
    },
    [runTurn, showPending, pushToast],
  );

  // Retry the last (failed) turn.
  const retryCall = useCallback(() => {
    const c = callRef.current;
    if (c) runTurn(c.threadId, c.annotationId);
  }, [runTurn]);

  // Keep what a cut-short turn wrote: the abort silences the agent (no
  // onDone/onError follows), so persisting the partial here is the only way it
  // survives. Nothing generated yet → nothing to keep. Returns the kept text.
  const keepPartial = useCallback((live: LiveTurn<CallMessage>) => {
    const partial = live.message.text.trim();
    if (partial) {
      appendMessage(live.bookId, live.threadId, { role: "ai", text: partial, ts: live.message.ts });
    }
    live.onSettled?.();
    return partial;
  }, []);

  // The stop button: end the open thread's turn, keeping the half sentence.
  const stopTurn = useCallback(() => {
    const c = callRef.current;
    if (!c) return;
    const live = liveTurnsRef.current.stop(c.threadId);
    if (!live) return;
    const { ts } = live.message;
    const partial = keepPartial(live);
    setCall((cur) =>
      !cur || cur.threadId !== c.threadId
        ? cur
        : {
            ...cur,
            messages: partial
              ? cur.messages.map((m) => (m.ts === ts && m.role === "ai" ? { role: "ai", text: partial, ts } : m))
              : cur.messages.filter((m) => !(m.ts === ts && m.role === "ai")),
          },
    );
  }, [keepPartial]);

  // Chat takes the whole window: from the bubble (reading shrinks to the corner
  // card) and back from the chat corner card.
  const showChatMain = useCallback(() => setCall((c) => (c ? { ...c, view: "chat-main" } : c)), []);
  // The other picture-in-picture swap: reading is back, chat shrinks.
  const swapToReading = useCallback(() => setCall((c) => (c ? { ...c, view: "chat-pip" } : c)), []);
  // The ✕ is one of several ways out (touching the book, opening another book,
  // closing the reader, Esc): the view goes away, the thread stays on its mark
  // (docs/03). An answer still being written is not interrupted — it finishes
  // into the thread file, and the mark shows it whole when it is next opened.
  // Images pasted but not sent stay on the thread, like the talk itself: this is
  // a way out of the view, not a way to throw the conversation away.
  const endCall = useCallback(() => {
    captureHangup();
    setCall(null);
  }, [captureHangup]);

  // Delete the open conversation. Destructive and confirmed at the button
  // (DeleteThreadButton's two-step). Removes the thread from its threads file and,
  // for a mark-anchored thread, its anchoring AI-pen mark too (the highlight and
  // its trace-list entry disappear); the book-level thread has no mark, so only
  // the thread goes. Both removals are in-file rewrites, so per-file LWW sync
  // carries them to other devices. Unlike a hangup this does not distill — the
  // talk is being thrown away — and anything already distilled from it stays.
  const deleteCallThread = useCallback(() => {
    const c = callRef.current;
    const bookId = bookIdRef.current;
    if (!c || !bookId) return;
    // The one close that does stop the turn: the conversation it would land in
    // is being thrown away.
    liveTurnsRef.current.stop(c.threadId);
    deleteThread(bookId, c.threadId);
    if (!c.isBook && c.annotationId) removeAnnotation(c.annotationId);
    const topicId = ctxRef.current.topicId;
    if (topicId) logEvent(topicId, "thread-delete", { threadId: c.threadId, book: c.isBook ?? false });
    // Nothing is left to send them to.
    pendingRef.current.clear(c.threadId);
    setCall(null);
  }, [removeAnnotation]);

  // Delete a mark from the trace list. This is the only way to get rid of an
  // AI-pen mark: tapping one on the page opens its conversation, so the
  // annotation editor's Delete never reaches it.
  //
  // The mark and its thread go together. The mark is the thread's only door —
  // tapping it on the page, or its sparkle in the trace list — so a thread left
  // behind is a conversation nothing can ever open again, syncing forever. That
  // is the same pairing deleteCallThread already makes from the other end. The
  // mark goes through removeAnnotation like every other deletion, so the
  // annotations file, the in-memory map and sync stay in agreement; the thread
  // goes through deleteThread, an in-file rewrite its own cache owns. What was
  // distilled from the talk stays, and the event log is appended to, not
  // rewritten.
  const deleteTraceAnnotation = useCallback(
    (id: string) => {
      const bookId = bookIdRef.current;
      const threadId = annsRef.current.get(id)?.aiThreadId as string | undefined;
      // A conversation open on this mark goes with it. Deleting the mark under a
      // live bubble and leaving the bubble on screen reads as a bug even when it
      // is not.
      if (callRef.current?.annotationId === id) setCall(null);
      // The turn and the unsent images go with the thread wherever it was
      // started from.
      if (threadId) {
        liveTurnsRef.current.stop(threadId);
        pendingRef.current.clear(threadId);
      }
      if (bookId && threadId && deleteThread(bookId, threadId)) {
        const topicId = ctxRef.current.topicId;
        if (topicId) logEvent(topicId, "thread-delete", { threadId, book: false });
      }
      removeAnnotation(id);
    },
    [removeAnnotation],
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
      const msgs = thread?.messages ?? [];
      setCall({ threadId, annotationId, view: "chat-main", anchor: { x: 0, y: 0 }, messages: openMessages(threadId, msgs) });
      hydrateThreadImages(threadId, msgs);
      if (needsFirstTurn(threadId, msgs)) runTurn(threadId, annotationId);
    },
    [runTurn, hydrateThreadImages, openMessages, needsFirstTurn],
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
    const msgs = thread.messages;
    setCall({
      threadId: thread.id,
      annotationId: "",
      isBook: true,
      view: "chat-main",
      anchor: { x: 0, y: 0 },
      messages: openMessages(thread.id, msgs),
    });
    hydrateThreadImages(thread.id, msgs);
    if (needsFirstTurn(thread.id, msgs)) runTurn(thread.id, "");
  }, [runTurn, hydrateThreadImages, openMessages, needsFirstTurn]);

  // Jump the reading back to the thread's mark (from the reading corner card).
  // The book-level thread has no mark, so there is nothing to jump to.
  const onPositionClick = useCallback(() => {
    setCall((c) => {
      if (c && c.annotationId) {
        viewRef.current?.selectAnnotations([c.annotationId]);
        viewRef.current?.navigate({ annotationID: c.annotationId });
      }
      return c;
    });
  }, []);

  const closeReader = useCallback(() => {
    // Leaving the book ends every turn it has running, each keeping what it
    // wrote. A background reply is tied to the book being read, not to the app;
    // this is where it stops. Turns on other books are left alone. Before the
    // hangup, so the distillation reads the partials too.
    const bookId = bookIdRef.current;
    if (bookId) for (const live of liveTurnsRef.current.stopBook(bookId)) keepPartial(live);
    // Closing the book with a call open ends that conversation too.
    captureHangup();
    void sweepDistillation("book-switch");
    // The last chapter can't be reached by a "next chapter" highlight, so on
    // close evaluate the notes frontier once with the inclusive rule (docs/14).
    // Fire before the refs are torn down below.
    finalPassNotes();
    setCall(null);
    // Staged images only ever lived in memory, so they were never going to
    // outlast the book anyway; they go with it.
    pendingRef.current.clearAll();
    setTitle(null);
    setPopup(null);
    setFulltext(null);
    setFulltextPending(false);
    setEmbedDoc(null);
    // Detach the prep UI; the pipeline keeps prepping in the background.
    resetPrep(false);
    bookIdRef.current = null;
    viewRef.current = null;
    pageDwellRef.current = null;
  }, [captureHangup, finalPassNotes, resetPrep, keepPartial]);

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
  // ignored while typing so it doesn't fight text input. callRef (not `call`)
  // keeps this listener stable across a streaming reply's frequent state churn.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === "Escape") {
        if (showSettings) setShowSettings(false);
        else if (quoteHlActive) viewRef.current?.clearQuoteHighlight();
        else if (callRef.current) endCall();
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
  }, [showSettings, popup, endCall, quoteHlActive, sidebarOpen]);

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
    <CardRegistryContext.Provider value={CARD_REGISTRY}>
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
          onPointerDownCapture={onPanePointerDown}
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
            const recent = mostRecentlyOpened(topics);
            return recent ? { title: recent.file.name, topicName: recent.topic.name } : null;
          })()}
          onContinue={continueReading}
          configured={configured}
          onOpenSettings={() => setShowSettings(true)}
          onTopicsChanged={refreshTopics}
        />

        {!inReader && homeScreen === "library" && (
          <LibraryScreen
            topics={topics}
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
            onDelete={deleteCallThread}
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
                onDelete={deleteCallThread}
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
    </CardRegistryContext.Provider>
  );
}

function callExcerpt(ann: Annotation | undefined): string {
  if (!ann) return "";
  if (typeof ann.text === "string" && ann.text) return ann.text;
  if (typeof ann.comment === "string" && ann.comment) return ann.comment;
  return "";
}
