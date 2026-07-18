import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  SpreadMode,
  type Annotation,
  type AnnotationPopupParams,
  type ViewInstance,
  type ViewState,
  type ViewStats,
} from "./reader-contract";
import { getViewState, hashPath, saveViewState } from "./storage";
import { chapterAt, ensureFulltext, getFulltext, onFulltextError, type Fulltext } from "./fulltext";
import Sidebar, { type SidebarTab } from "./components/Sidebar";
import {
  annotationPage,
  buildReadingTools,
  surroundingText,
  toolStatusLabel,
  type AnnotationLite,
  type TopicMaterial,
} from "./ai/reading-context";
import {
  ANNOTATION_COLORS,
  deleteAnnotations,
  loadAnnotations,
  onSaveError,
  saveAnnotations,
} from "./annotations";
import {
  addFileToTopic,
  createTopic,
  deleteTopic,
  listTopics,
  markOpened,
  removeFileFromTopic,
  renameTopic,
  sortedFiles,
  type Topic,
} from "./topics";
import {
  appendMessage,
  createBookThread,
  createThread,
  getBookThread,
  getThread,
  loadThreads,
  onThreadSaveError,
  readThreadImages,
  saveThreadImages,
  type ThreadMessage,
} from "./threads";
import { compressImage, compressImageData, type CompressedImage } from "./ai/image-utils";
import { isTauri, readClipboardImage } from "./clipboard";
import { DEFAULT_SETTINGS, loadSettings, onSettingsSaveError, saveSettings, toReasoning, type Settings } from "./settings";
import { buildSystemPrompt, type BooklistItem } from "./context";
import {
  installFetchBridge,
  listProviders,
  modelSupportsImages,
  runAgentTurn,
  type ProviderId,
  type ProviderInfo,
} from "./aiClient";
import {
  buildClassroomSystemPrompt,
  buildClassroomTools,
  chapterIndexForPage,
  getPrepPipeline,
  hasPrepState,
  papersForChapter,
  parseNote,
  peekPrepPipeline,
  readPrepNote,
  type Citation,
  type PrepSnapshot,
} from "./prep";
import type { PrepPipeline } from "./prep/pipeline";
import type { ClassroomNote } from "./prep/classroom";
import {
  buildMemorySnapshot,
  buildMemoryTools,
  distillThread,
  getLastDistillation,
  getMemoryAdapter,
  memoryPromptSection,
  notifyMemoryChange,
  onMemoryChange,
  type MemoryEntry,
} from "./memory";
import { logEvent } from "./events";
import { prewarmPdfiumEngine } from "./reader-embedpdf/engine-singleton";
import EmbedReaderPane from "./reader-embedpdf/EmbedReaderPane";
import { CitationContext, FigureContext, type FigureHost } from "./components/Markdown";
import {
  buildFigureCatalog,
  buildFigureTools,
  clearFigureCache,
  ensureFigures,
  findFigureById,
  renderFigure,
  type Figure,
  type FiguresIndex,
} from "./figures";
import PrepPanel from "./components/PrepPanel";
import MemoryPanel from "./components/MemoryPanel";
import PenToolbar from "./components/PenToolbar";
import { IconSparkle } from "./components/icons";
import AnnotationPopup from "./components/AnnotationPopup";
import CallBubble from "./components/CallBubble";
import CallView from "./components/CallView";
import ReadingPipCard from "./components/ReadingPipCard";
import ChatPipCard from "./components/ChatPipCard";
import SettingsView from "./components/SettingsView";
import Toast, { useToasts } from "./components/Toast";
import type { Annotation as PopupAnnotation, PendingImage, ToolStatus, ToolType } from "./components/types";

// Auto-explanation kickoff (docs/03: the bubble starts explaining, unprompted).
const EXPLAIN_KICKOFF = "Please explain the passage I just marked, using the reading context above.";
// The AI pen maps to the engine's underline tool in a fixed purple (the palette's
// Purple). Owning this one color for the AI pen is a v1 implementation
// convenience, not a semantic in the color palette; the host identifies AI-pen
// strokes by the active tool, not the color.
const AI_PEN_COLOR = "#a28ae5";
// Cap on images attached to one chat turn (docs/03: paste screenshots to ask).
const MAX_PENDING_IMAGES = 3;
// Replayed thread history is trimmed to this many messages per turn; crossing
// the cap fires the fallback memory distillation before older turns fall out
// of context (docs/02: hangup is the main trigger, trimming the backstop).
const HISTORY_KEEP = 40;
// The trim-triggered distillation re-fires only after this many new messages.
const TRIM_DISTILL_MIN_NEW = 20;

// Shared utility-class strings for the shell chrome (migrated from styles.css).
// Split so variant overrides never collide with base padding/border utilities.
const BTN_BASE =
  "leading-none border rounded-md bg-white cursor-pointer enabled:hover:bg-[#f0f0f0] disabled:opacity-40 disabled:cursor-default";
const BTN = `${BTN_BASE} text-sm px-3 py-1.5 border-[#dcdcdc]`;
const BTN_PRIMARY = "text-sm leading-none px-3 py-1.5 rounded-md bg-[#6c4fd0] text-white cursor-pointer enabled:hover:bg-[#5a3fbf] disabled:opacity-40";
const BTN_SM = `${BTN_BASE} text-xs px-2 py-1 border-[#dcdcdc]`;
const BTN_SM_DANGER = `${BTN_BASE} text-xs px-2 py-1 border-[#f0c8c8] text-[#b91c1c]`;
// Pressed state for a toggle button; spelled out rather than appended to BTN_SM
// because two background utilities in one class list resolve by stylesheet order.
const BTN_SM_ON =
  "text-xs leading-none px-2 py-1 border rounded-md border-[#c9c2e8] bg-[#efecfb] text-[#4a3a9e] cursor-pointer enabled:hover:bg-[#e7e3f7] disabled:opacity-40 disabled:cursor-default";
const INPUT = "flex-1 px-2.5 py-2 border border-[#dcdcdc] rounded-md [font:inherit]";
const LIBRARY = "w-[min(680px,100%)] mx-auto px-6 py-10";
const TOPIC_LIST = "list-none m-0 p-0 flex flex-col gap-1.5";
const TOPIC_ROW = "flex items-center gap-2 border border-[#dcdcdc] rounded-lg py-1 pl-1 pr-1.5";
const TOPIC_NAME =
  "flex-1 flex items-baseline gap-2.5 text-left px-2.5 py-2 border-0 bg-transparent cursor-pointer text-[15px] rounded-md hover:bg-[#f0f0f0]";

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
  images?: { data: string; mediaType: string }[];
  streaming?: boolean;
  failed?: boolean;
  // Transient tool-call trace for a streaming AI turn (M6); never persisted.
  tools?: ToolStatus[];
};

// Persisted thread messages -> display messages. Image bytes are loaded
// separately (hydrateThreadImages), so images start absent here.
function toDisplayMessages(msgs: ThreadMessage[]): CallMessage[] {
  return msgs.map((m) => ({ role: m.role, text: m.text, ts: m.ts }));
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
  const pathRef = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const lastState = useRef<ViewState | null>(null);

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
  // Abort controller for the in-flight stream (cancelled on hangup / switch).
  const abortRef = useRef<AbortController | null>(null);
  // Text streamed so far in the current turn, so stopping can keep it.
  const partialRef = useRef("");
  // Whether a turn is streaming, mirrored for the pdf-iframe pointerdown listener.
  const streamingRef = useRef(false);
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
    files: { path: string; name: string }[];
  }>({
    topicId: null,
    topicName: "",
    fileName: "",
    pageLabel: null,
    pageIndex: null,
    files: [],
  });
  // Classroom mode (docs/09), mirrored for the stable runTurn callback.
  const classroomRef = useRef(false);
  // The lesson-prep pipeline attached to the open book (module singleton; this
  // ref only tracks which one the UI is looking at) and its unsubscribe.
  const pipelineRef = useRef<PrepPipeline | null>(null);
  const prepUnsubRef = useRef<(() => void) | null>(null);
  // Event-log instrumentation (M8). Dwell: the page being read and when it was
  // entered. lastCallThread: the thread a call-start was last logged for.
  // prepStatuses: paper statuses already seen, so only transitions are logged.
  const pageDwellRef = useRef<{ page: number; since: number } | null>(null);
  const lastCallThreadRef = useRef<string | null>(null);
  const prepStatusesRef = useRef<Map<string, string>>(new Map());

  const [topics, setTopics] = useState<Topic[]>([]);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [newTopicName, setNewTopicName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  // The open book: bytes + saved state for EmbedReaderPane; null in the library.
  const [embedDoc, setEmbedDoc] = useState<{
    path: string;
    name: string;
    buffer: ArrayBuffer;
    annotations: Annotation[];
    viewState: ViewState | null;
  } | null>(null);

  const [stats, setStats] = useState<ViewStats | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [toolType, setToolType] = useState<ToolType>("pointer");
  const [penColor, setPenColor] = useState(ANNOTATION_COLORS[0].color);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [viewReady, setViewReady] = useState(false);
  const [traceAnns, setTraceAnns] = useState<Annotation[]>([]);
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("traces");
  // The current book's extracted text (M6 AI context) and outline (Sidebar).
  // Set from openInReader once ensureFulltext resolves; see the comment there.
  const [fulltext, setFulltext] = useState<Fulltext | null>(null);
  const [fulltextPending, setFulltextPending] = useState(false);
  // Resolved figure list for the current book (M9), feeding the inline [fig:N]
  // card host and empty until extraction finishes.
  const [figures, setFigures] = useState<Figure[]>([]);
  const [call, setCall] = useState<CallState | null>(null);
  // Classroom mode + lesson prep (docs/09). classroomOn is per open book and
  // resets on open/close; prepSnap mirrors the pipeline for the panel.
  const [classroomOn, setClassroomOn] = useState(false);
  const [prepSnap, setPrepSnap] = useState<PrepSnapshot | null>(null);
  const [selectedPrepSlug, setSelectedPrepSlug] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [showSettings, setShowSettings] = useState(false);
  const [providersInfo, setProvidersInfo] = useState<ProviderInfo[]>([]);
  // Failure messages (save/load/network errors) live here, not in `status` —
  // `status` is reserved for transient reader progress ("Rendering…").
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  // Images pasted into the composer, awaiting send: a placeholder appears while
  // the async compression runs, then resolves to a ready preview. A single
  // document-level paste listener fills these; the composer only renders them.
  // The ref mirrors state synchronously so bursts of pastes and the stable send
  // handler all see the current list without waiting for a re-render.
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const pendingImagesRef = useRef<PendingImage[]>([]);
  const mutatePending = useCallback((fn: (cur: PendingImage[]) => PendingImage[]) => {
    const next = fn(pendingImagesRef.current);
    pendingImagesRef.current = next;
    setPendingImages(next);
  }, []);
  // Inline note under the composer when a paste is rejected (model can't see it).
  const [imageHint, setImageHint] = useState("");

  // Mirror the call (view for the pdf listener, whole thing for send handlers).
  const callRef = useRef<CallState | null>(null);
  useEffect(() => {
    callViewRef.current = call?.view ?? "none";
    callRef.current = call;
    const last = call?.messages[call.messages.length - 1];
    streamingRef.current = !!(last?.role === "ai" && last.streaming);
  }, [call]);

  // Prewarm the PDFium engine so the wasm is compiled before the first book
  // open, not on its critical path.
  useEffect(() => {
    prewarmPdfiumEngine();
  }, []);

  // Install the Tauri fetch bridge + load settings once.
  useEffect(() => {
    installFetchBridge();
    loadSettings().then(setSettings).catch(() => {});
    onSettingsSaveError((e) => {
      console.error("failed to persist settings", e);
      pushToast("warn", "Settings could not be saved");
    });
  }, []);

  // Refresh provider connection state on mount and whenever Settings closes.
  useEffect(() => {
    if (!showSettings) listProviders().then(setProvidersInfo).catch(() => {});
  }, [showSettings]);

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
      files: activeTopic?.files.map((f) => ({ path: f.path, name: f.name })) ?? [],
    };
  });

  useEffect(() => {
    classroomRef.current = classroomOn;
  }, [classroomOn]);

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

  // Lazy prep follows the reader: on every page change, tell the scheduler
  // which chapter the user is in so its papers prep first.
  useEffect(() => {
    const chapters = prepSnap?.state?.chapters;
    if (!chapters || !stats) return;
    pipelineRef.current?.setCurrentChapter(chapterIndexForPage(chapters, stats.pageIndex + 1));
  }, [stats, prepSnap]);

  const applySettings = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const activeTopic = useMemo(
    () => topics.find((t) => t.id === activeTopicId) ?? null,
    [topics, activeTopicId],
  );

  const refreshTopics = useCallback(async () => {
    setTopics(await listTopics());
  }, []);

  useEffect(() => {
    refreshTopics().catch(() => {});
    onSaveError((e) => {
      console.error("failed to persist annotations", e);
      pushToast("warn", "Annotations could not be saved");
    });
    onThreadSaveError((e) => {
      console.error("failed to persist thread", e);
      pushToast("warn", "AI conversation could not be saved");
    });
    // Full-text extraction is best-effort background context; a persistence
    // failure only warns (the AI falls back to the marked passage), no UI needed.
    onFulltextError((e) => console.warn("failed to persist fulltext cache", e));
  }, [refreshTopics]);

  // Apply the tool once the view is initialized (setTool before the pdf viewer
  // is ready throws — PDFViewerApplication null, pitfall 11). The AI pen is the
  // underline tool in a fixed purple.
  useEffect(() => {
    aiPenRef.current = toolType === "ai";
    if (!viewReady) return;
    const tool =
      toolType === "pointer"
        ? { type: "pointer" as const }
        : toolType === "ai"
          ? { type: "underline" as const, color: AI_PEN_COLOR }
          : { type: toolType, color: penColor };
    viewRef.current?.setTool(tool);
  }, [toolType, penColor, viewReady]);

  // Debounced persist of the reading position. A save failure must be visible;
  // silently losing positions looks fine until the app is reopened (pitfall 09).
  const persist = useCallback((state: ViewState) => {
    const path = pathRef.current;
    if (!path) return;
    lastState.current = state;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveViewState(path, state).catch((e) => {
        console.error("failed to persist reading position", e);
        pushToast("warn", "Reading position could not be saved");
      });
    }, 500);
  }, [pushToast]);

  useEffect(() => {
    const flush = () => {
      const path = pathRef.current;
      if (!path || !lastState.current) return;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      void saveViewState(path, lastState.current).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  const syncTraceList = useCallback(() => {
    setTraceAnns([...annsRef.current.values()]);
  }, []);

  const persistAnnotations = useCallback(() => {
    const path = pathRef.current;
    if (path) saveAnnotations(path, [...annsRef.current.values()]);
  }, []);

  // Load a thread's stored images (filenames -> base64) and patch them into the
  // open call so the bubbles show them. Async so opening a thread stays instant.
  const hydrateThreadImages = useCallback((threadId: string, msgs: ThreadMessage[]) => {
    const withImages = msgs.filter((m) => m.images && m.images.length > 0);
    if (withImages.length === 0) return;
    void (async () => {
      const loaded = new Map<number, { data: string; mediaType: string }[]>();
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

  // Attach the open book's prep pipeline to the UI: subscribe the panel and
  // (re)start the background run. Idempotent — the pipeline is a module
  // singleton per survey, so re-attaching never restarts finished work.
  const attachPipeline = useCallback((path: string, name: string, ft: Fulltext) => {
    const pipeline = getPrepPipeline(path, name, ft);
    pipelineRef.current = pipeline;
    prepUnsubRef.current?.();
    prepStatusesRef.current = new Map();
    const sync = () => {
      const snap = pipeline.snapshot();
      // Log paper status transitions (not the initial statuses on attach).
      const topicId = ctxRef.current.topicId;
      for (const p of snap.state?.papers ?? []) {
        const prev = prepStatusesRef.current.get(p.slug);
        if (prev === p.status) continue;
        prepStatusesRef.current.set(p.slug, p.status);
        if (prev !== undefined && topicId) {
          logEvent(topicId, "prep-status", { slug: p.slug, status: p.status });
        }
      }
      setPrepSnap(snap);
    };
    prepUnsubRef.current = pipeline.subscribe(sync);
    sync();
    void pipeline.ensureStarted();
  }, []);

  // First classroom press (or the panel's Start button) kicks off lesson prep.
  const startPrep = useCallback(async () => {
    const path = pathRef.current;
    const name = ctxRef.current.fileName;
    if (!path) return;
    const ft = await currentFulltextRef.current;
    if (pathRef.current !== path) return; // switched books while extracting
    if (!ft || ft.status !== "ok") {
      pushToast("warn", "This book has no readable text layer, so prep can't run.");
      return;
    }
    attachPipeline(path, name, ft);
  }, [attachPipeline, pushToast]);

  const toggleClassroom = useCallback(() => {
    // Outside the state updater: StrictMode double-invokes updaters, which
    // would double-log the event.
    const next = !classroomRef.current;
    const topicId = ctxRef.current.topicId;
    if (topicId) logEvent(topicId, "classroom-toggle", { on: next });
    if (next) void startPrep();
    setClassroomOn(next);
  }, [startPrep]);

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
      viewRef.current?.navigate({ pageIndex: c.page - 1 });
    } else if (c.kind === "figure") {
      const fig = findFigureById(figuresRef.current, c.id);
      if (fig) viewRef.current?.navigate({ pageIndex: fig.page - 1 });
    } else {
      setSelectedPrepSlug(c.slug);
      setSidebarTab("prep");
      setSidebarOpen(true);
    }
    setCall((cur) => (cur && cur.view === "chat-main" ? { ...cur, view: "chat-pip" } : cur));
  }, []);

  // The prep panel reads a note's body on expand (frontmatter stripped).
  const loadPrepNoteBody = useCallback(async (slug: string) => {
    const path = pathRef.current;
    if (!path) return null;
    const raw = await readPrepNote(hashPath(path), slug);
    return raw ? parseNote(raw).body : null;
  }, []);

  // Memory panel data (M8): loaded when the tab shows, refreshed when a
  // background write (distillation or an in-chat memory_update) lands.
  const [memEntries, setMemEntries] = useState<MemoryEntry[] | null>(null);
  const [memLastDistill, setMemLastDistill] = useState<number | null>(null);
  const refreshMemory = useCallback(() => {
    const topicId = activeTopicId;
    if (!topicId) return;
    void (async () => {
      try {
        const entries = await getMemoryAdapter(topicId).listObservations();
        const last = await getLastDistillation(topicId);
        setMemEntries(entries);
        setMemLastDistill(last);
      } catch (e) {
        console.warn("failed to load memory", e);
        setMemEntries([]);
      }
    })();
  }, [activeTopicId]);

  useEffect(() => {
    setMemEntries(null);
    setMemLastDistill(null);
  }, [activeTopicId]);

  useEffect(() => {
    if (title && sidebarOpen && sidebarTab === "memory") refreshMemory();
  }, [title, sidebarOpen, sidebarTab, refreshMemory]);

  useEffect(
    () =>
      onMemoryChange((topicId) => {
        if (topicId === activeTopicId) refreshMemory();
      }),
    [activeTopicId, refreshMemory],
  );

  const prepSkip = useCallback((slug: string) => pipelineRef.current?.skip(slug), []);
  const prepRequeue = useCallback((slug: string) => pipelineRef.current?.requeue(slug), []);
  const prepAdd = useCallback((query: string) => pipelineRef.current?.addPaper(query), []);
  const prepStart = useCallback(() => void startPrep(), [startPrep]);
  const prepRetryPlan = useCallback(() => pipelineRef.current?.retryPlan(), []);
  const prepReplan = useCallback(() => pipelineRef.current?.replan(), []);

  // Run one assistant turn for a thread: assemble the reading context, stream the
  // reply into the bubble, persist on done. Stable (reads refs). No-ops (leaving
  // the bubble empty for the guidance) when no provider is configured.
  const runTurn = useCallback((threadId: string, annotationId: string) => {
    const path = pathRef.current;
    const s = settingsRef.current;
    if (!path || !s.defaultProviderId || !s.defaultModelId) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    partialRef.current = "";

    const patch = (
      fn: (m: CallMessage) => CallMessage,
      ts: number,
      error?: boolean,
    ) =>
      setCall((c) =>
        !c || c.threadId !== threadId
          ? c
          : {
              ...c,
              error: error ?? c.error,
              messages: c.messages.map((m) => (m.ts === ts && m.role === "ai" ? fn(m) : m)),
            },
      );

    // Push a running tool status onto the streaming reply; clearing any partial
    // text discards inter-round preamble so only the final answer shows (M6).
    const onToolStart = (info: { name: string; args: Record<string, any> }, ts: number) => {
      partialRef.current = "";
      patch(
        (m) => ({
          ...m,
          text: "",
          tools: [
            ...(m.tools ?? []),
            { name: info.name, label: toolStatusLabel(info.name, info.args), state: "running" as const },
          ],
        }),
        ts,
      );
    };
    // Resolve the matching running status: drop it on success, mark it failed on
    // error (soft-error style, left visible).
    const onToolEnd = (info: { name: string; isError: boolean }, ts: number) =>
      patch((m) => {
        const tools = [...(m.tools ?? [])];
        let idx = -1;
        for (let i = 0; i < tools.length; i++) {
          if (tools[i].state === "running" && tools[i].name === info.name) idx = i;
        }
        if (idx < 0) return m;
        if (info.isError) tools[idx] = { ...tools[idx], state: "error" };
        else tools.splice(idx, 1);
        return { ...m, tools };
      }, ts);

    const ann = annsRef.current.get(annotationId);
    const ts = Date.now();
    setCall((c) => {
      if (!c || c.threadId !== threadId) return c;
      const kept = c.messages.filter((m) => !(m.role === "ai" && (m.failed || m.streaming)));
      return { ...c, error: false, messages: [...kept, { role: "ai", text: "", ts, streaming: true }] };
    });

    void (async () => {
      // Assemble the live reading context and topic-scoped tools (M6). The
      // current book's extraction may still be running; await it so the AI can
      // see the page. Thread images (stored as filenames) are read back too.
      const currentFulltext = (await currentFulltextRef.current) ?? null;
      const { topicId, topicName, fileName, pageLabel, pageIndex, files } = ctxRef.current;
      const materials = await gatherTopicMaterials(
        files,
        path,
        currentFulltext,
        [...annsRef.current.values()],
      );
      // The book-level thread (top-bar AI button) has no mark: its position is
      // wherever the reader currently is, and it carries no selection-derived
      // context (marked passage / surrounding text).
      const isBook = annotationId === "";
      const currentPage = pageIndex !== null ? pageIndex + 1 : null;
      const page = isBook
        ? currentPage
        : annotationPage(ann as { position?: { pageIndex?: number } } | undefined);
      const chapterTitle =
        currentFulltext && page ? chapterAt(currentFulltext, page)?.title ?? null : null;
      const surrounding =
        !isBook && currentFulltext && page ? surroundingText(currentFulltext, page) : "";
      const booklist: BooklistItem[] = materials
        .filter((m) => m.path !== path)
        .map((m) => ({
          label: m.label,
          pageCount: m.fulltext?.pages.length ?? 0,
          annotationCount: m.annotations.length,
          fulltextAvailable: m.fulltext?.status === "ok",
          isCurrent: false,
        }));
      const selectionText = typeof ann?.text === "string" ? ann.text : "";
      const selectionComment = typeof ann?.comment === "string" ? ann.comment : undefined;

      // Classroom mode swaps the context assembly (docs/09): the whole survey
      // rides in a stable prompt prefix, this chapter's prep notes follow, and
      // paper tools join the M6 reading tools. Companion mode is untouched.
      let systemPrompt: string;
      let tools = buildReadingTools({ currentFulltext, materials });
      // Per-topic memory (M8): the memory tools join the same loop as the
      // reading tools; the opening snapshot rides the system prompt below.
      let memorySection = "";
      if (topicId) {
        const memory = getMemoryAdapter(topicId);
        const observations = await memory.listObservations().catch((): MemoryEntry[] => []);
        tools = [...tools, ...buildMemoryTools(memory, { onWrite: () => notifyMemoryChange(topicId) })];
        memorySection = memoryPromptSection(buildMemorySnapshot(observations), true);
      }
      // Figure catalog + view_figure tool (M9): the model can cite figures as
      // [fig:N] (rendered inline in chat) and open one to actually see it.
      const figuresIndex = (await currentFiguresRef.current)?.figures ?? [];
      const figureCatalog = figuresIndex.length
        ? buildFigureCatalog(figuresIndex, { currentPage: page ?? currentPage ?? null })
        : "";
      if (figuresIndex.length) {
        const supportsImages = modelSupportsImages(
          s.defaultProviderId as ProviderId,
          s.defaultModelId as string,
        );
        const buf = bufferRef.current;
        const figHash = hashPath(path);
        tools = [
          ...tools,
          ...buildFigureTools({
            figures: figuresIndex,
            modelSupportsImages: supportsImages,
            renderImage: async (fig) => {
              if (!buf) return null;
              const r = await renderFigure(figHash, buf, fig, "view");
              return r ? { base64: r.base64, mimeType: r.mimeType } : null;
            },
          }),
        ];
      }
      const prepState = pipelineRef.current?.snapshot().state ?? null;
      if (classroomRef.current && currentFulltext?.status === "ok") {
        const here = page ?? (pageIndex !== null ? pageIndex + 1 : 1);
        const chapterIdx = prepState ? chapterIndexForPage(prepState.chapters, here) : 1;
        const notePapers = prepState ? papersForChapter(prepState.papers, chapterIdx) : [];
        const notes = (
          await Promise.all(
            notePapers.map(async (p): Promise<ClassroomNote | null> => {
              const raw = await readPrepNote(hashPath(path), p.slug);
              return raw ? { slug: p.slug, title: p.title, body: parseNote(raw).body } : null;
            }),
          )
        ).filter((n): n is ClassroomNote => n !== null);
        if (prepState) tools = [...tools, ...buildClassroomTools(prepState)];
        systemPrompt = buildClassroomSystemPrompt({
          topicName,
          surveyName: fileName,
          fulltext: currentFulltext,
          pageLabel,
          chapterTitle,
          selectionText,
          selectionComment,
          notes,
          prep: prepState,
          hasTools: tools.length > 0,
          figureCatalog,
        });
      } else {
        systemPrompt = buildSystemPrompt({
          topicName,
          fileName,
          pageLabel,
          selectionText,
          selectionComment,
          chapterTitle,
          surroundingText: surrounding,
          fulltextAvailable: currentFulltext?.status === "ok",
          materials: booklist,
          figureCatalog,
          hasTools: tools.length > 0,
          bookLevel: isBook,
        });
      }
      if (memorySection) systemPrompt += "\n\n" + memorySection;

      const threadMsgs = getThread(path, threadId)?.messages ?? [];
      const prior = await Promise.all(
        threadMsgs.map(async (m) => ({
          role: m.role,
          text: m.text,
          images: m.images?.length ? await readThreadImages(threadId, m.images) : undefined,
        })),
      );
      if (controller.signal.aborted) return;
      // Replay only the tail of a long thread, and before the older turns fall
      // out of context, run the fallback distillation (docs/02: hangup is the
      // main trigger, the trim is the backstop).
      let history = prior;
      if (prior.length > HISTORY_KEEP) {
        history = prior.slice(prior.length - HISTORY_KEEP);
        if (topicId) {
          void distillThread(
            {
              topicId,
              topicName,
              bookName: fileName,
              threadId,
              annotationId,
              page,
              markedText: selectionText,
              messages: threadMsgs.map(({ role, text, ts }) => ({ role, text, ts })),
            },
            TRIM_DISTILL_MIN_NEW,
          );
        }
      }
      const apiMessages = [{ role: "user" as const, text: EXPLAIN_KICKOFF }, ...history];

      void runAgentTurn({
        providerId: s.defaultProviderId as ProviderId,
        modelId: s.defaultModelId as string,
        systemPrompt,
        messages: apiMessages,
        tools,
        signal: controller.signal,
        reasoning: toReasoning(s.chatThinking),
        onDelta: (chunk) => {
          partialRef.current += chunk;
          patch((m) => ({ ...m, text: m.text + chunk }), ts);
        },
        onToolStart: (info) => onToolStart(info, ts),
        onToolEnd: (info) => onToolEnd(info, ts),
        onDone: (full) => {
          if (abortRef.current === controller) abortRef.current = null;
          if (controller.signal.aborted) return; // stopTurn already kept the partial
          patch((m) => ({ role: "ai", text: full, ts, tools: (m.tools ?? []).filter((t) => t.state === "error") }), ts);
          appendMessage(path, threadId, { role: "ai", text: full, ts });
        },
        onError: (message: string) => {
          if (abortRef.current === controller) abortRef.current = null;
          if (controller.signal.aborted) return; // switch/hangup, not a failure
          console.error("agent turn failed", message);
          pushToast("error", "AI reply failed");
          patch(() => ({ role: "ai", text: `⚠️ Couldn't reach the model. ${message}`, ts, failed: true }), ts, true);
        },
      });
    })();
  }, [pushToast]);

  // Engine created/modified annotations (drag-to-highlight, AI-pen underline, etc.).
  // A brand-new annotation drawn while the AI pen is active starts a thread and
  // opens the call bubble.
  const onSaveAnnotations = useCallback(
    (incoming: Annotation[]) => {
      let aiCreated: { annotation: Annotation; threadId: string } | null = null;
      for (const a of incoming) {
        const { onlyTextOrComment, ...clean } = a as Annotation & { onlyTextOrComment?: boolean };
        void onlyTextOrComment;
        const isNew = !annsRef.current.has(clean.id);
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

      if (aiCreated) {
        // Persist the aiThreadId into the engine model, open the thread + bubble.
        viewRef.current?.setAnnotations([aiCreated.annotation]);
        const path = pathRef.current;
        if (path) createThread(path, aiCreated.annotation.id, aiCreated.threadId);
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
    [persistAnnotations, syncTraceList, runTurn],
  );

  const onDeleteAnnotations = useCallback(
    (ids: string[]) => {
      for (const id of ids) annsRef.current.delete(id);
      const path = pathRef.current;
      if (path) deleteAnnotations(path, ids);
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
      const path = pathRef.current;
      const thread = path ? getThread(path, threadId) : undefined;
      abortRef.current?.abort(); // stop any stream from a previously open thread
      setPopup(null);
      const msgs = thread?.messages ?? [];
      setCall({ threadId, annotationId: ann.id, view: "bubble", anchor, messages: toDisplayMessages(msgs) });
      hydrateThreadImages(threadId, msgs);
      // Empty thread (e.g. created before a provider was configured) → explain now.
      if (msgs.length === 0) runTurn(threadId, ann.id);
    } else {
      setPopup({ annotation: ann, anchor });
    }
  }, [runTurn, hydrateThreadImages]);

  // The pen stroke gives the host no coordinates, so track the last pen-lift
  // over the reader pane as the AI-pen bubble anchor (capture phase, so nothing
  // inside the engine can swallow it).
  const onPanePointerUp = useCallback((e: React.PointerEvent) => {
    penUpRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  // Touching the book dismisses the bubble / chat corner card (docs/03).
  // chat-main is not dismissable this way (CallView covers the reader). AI-pen
  // draws and mark clicks fire this on pointerdown, then re-open on save/select.
  const onPanePointerDown = useCallback(() => {
    // A streaming reply is not dismissable this way: the click would abort the
    // turn and throw the half-written answer away. Stop it, or dismiss once it
    // lands.
    if (streamingRef.current) return;
    if (callViewRef.current === "bubble" || callViewRef.current === "chat-pip") {
      setCall(null);
    }
  }, []);

  const openInReader = useCallback(
    async (path: string, name: string, bytes: Uint8Array) => {
      setStatus("Rendering…");
      setPopup(null);
      setCall(null);
      setSelectedAnnId(null);
      const state = await getViewState(path);
      let saved: Annotation[] = [];
      try {
        saved = await loadAnnotations(path);
      } catch (e) {
        console.error("failed to load annotations", e);
        pushToast("warn", "Saved annotations could not be loaded");
      }
      try {
        await loadThreads(path);
      } catch (e) {
        console.error("failed to load threads", e);
        pushToast("warn", "Saved AI conversations could not be loaded");
      }
      annsRef.current = new Map(saved.map((a) => [a.id, a]));
      setTraceAnns(saved);

      setViewReady(false);
      pathRef.current = path;
      // Dwell tracking restarts per book (never a cross-book page-nav event).
      pageDwellRef.current = null;
      // Classroom mode is per book; detach the previous book's prep panel (the
      // pipeline itself keeps running in the background as a module singleton).
      setClassroomOn(false);
      setSelectedPrepSlug(null);
      prepUnsubRef.current?.();
      prepUnsubRef.current = null;
      pipelineRef.current = null;
      setPrepSnap(null);
      // Extract the full text in the background so the AI can see the book
      // (M6). Fire-and-forget: never blocks rendering. Extraction's pdf.js
      // transfers its buffer to a worker (detaching it), so extraction gets its
      // own synchronous copy here and never races the engine for the bytes.
      setFulltextPending(true);
      setFulltext(null);
      // Reset the figure index + cached crops for the new book (M9).
      setFigures([]);
      figuresRef.current = [];
      clearFigureCache();
      bufferRef.current = bytes.slice().buffer as ArrayBuffer;
      currentFiguresRef.current = ensureFigures(path, bytes.slice().buffer as ArrayBuffer).catch((e) => {
        console.warn("failed to extract figures", e);
        return null;
      });
      currentFiguresRef.current.then((idx) => {
        if (pathRef.current !== path) return; // stale: the user switched books
        const list = idx?.figures ?? [];
        figuresRef.current = list;
        setFigures(list);
      });
      currentFulltextRef.current = ensureFulltext(path, bytes.slice().buffer as ArrayBuffer).catch(
        (e) => {
          console.warn("failed to extract fulltext", e);
          return null;
        },
      );
      currentFulltextRef.current.then(async (ft) => {
        if (pathRef.current !== path) return; // stale: the user switched books
        setFulltext(ft);
        setFulltextPending(false);
        // Resume lesson prep from its persisted state (docs/09: restartable
        // from the breakpoint) or re-attach a pipeline already running.
        if (ft && ft.status === "ok") {
          try {
            if (peekPrepPipeline(path) || (await hasPrepState(path))) {
              if (pathRef.current === path) attachPipeline(path, name, ft);
            }
          } catch (e) {
            console.warn("failed to resume lesson prep", e);
          }
        }
      });

      // Mount EmbedReaderPane with the bytes. It calls back onView (sets
      // viewRef) and onInitialized once ready. A fresh copy of the bytes is
      // handed over so nothing detaches the shell's original.
      setEmbedDoc({
        path,
        name,
        buffer: bytes.slice().buffer as ArrayBuffer,
        annotations: saved,
        viewState: state,
      });
      setTitle(name);
    },
    [pushToast, attachPipeline],
  );

  const openFile = useCallback(
    async (path: string, name: string) => {
      if (!activeTopicId) return;
      try {
        const bytes = await readFile(path);
        await openInReader(path, name, bytes);
        await markOpened(activeTopicId, path);
        await refreshTopics();
      } catch {
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
      const path = pathRef.current;
      if (path) deleteAnnotations(path, [id]);
      syncTraceList();
      setPopup(null);
    },
    [syncTraceList],
  );

  // Trace-list click: jump to the mark. Programmatic select does not open the
  // popup (pitfall 04), which is what we want for a list jump.
  const onTraceSelect = useCallback((id: string) => {
    viewRef.current?.selectAnnotations([id]);
    viewRef.current?.navigate({ annotationID: id });
    setSelectedAnnId(id);
  }, []);

  // Stage an image for the next send: a placeholder shows immediately, the async
  // compression runs, then the ready preview swaps in (or it's dropped + a hint
  // on failure). Capped at MAX_PENDING_IMAGES.
  const stageImage = useCallback(
    (produce: () => Promise<CompressedImage>) => {
      if (pendingImagesRef.current.length >= MAX_PENDING_IMAGES) {
        setImageHint(`You can attach up to ${MAX_PENDING_IMAGES} images.`);
        return;
      }
      const id = crypto.randomUUID();
      mutatePending((cur) => [...cur, { id, status: "loading" }]);
      produce().then(
        (img) =>
          mutatePending((cur) =>
            cur.map((p) => (p.id === id ? { id, status: "ready", data: img.data, mediaType: img.mediaType } : p)),
          ),
        (e) => {
          console.error("failed to process pasted image", e);
          mutatePending((cur) => cur.filter((p) => p.id !== id));
          setImageHint(e instanceof Error ? e.message : "Couldn't process that image");
        },
      );
    },
    [mutatePending],
  );

  const removePendingImage = useCallback(
    (id: string) => mutatePending((cur) => cur.filter((p) => p.id !== id)),
    [mutatePending],
  );

  const clearPendingImages = useCallback(() => {
    mutatePending(() => []);
    setImageHint("");
  }, [mutatePending]);

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
          setImageHint("This model can't read images. Switch to a vision model in Settings.");
          return;
        }
        setImageHint("");
        for (const b of blobs) stageImage(() => compressImage(b));
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
          setImageHint("Couldn't read an image from the clipboard.");
          return;
        }
        if (!modelTakesImages()) {
          setImageHint("This model can't read images. Switch to a vision model in Settings.");
          return;
        }
        setImageHint("");
        stageImage(() => compressImageData(img.rgba, img.width, img.height));
      })();
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [call, stageImage, modelTakesImages]);

  // Sending appends the user line (with any ready staged images, persisted to
  // disk) then streams the reply. Empty text with images is allowed; images
  // still compressing block the send (the composer disables it too).
  const sendCallMessage = useCallback(
    (text: string) => {
      const c = callRef.current;
      const path = pathRef.current;
      const staged = pendingImagesRef.current;
      const trimmed = text.trim();
      if (staged.some((p) => p.status === "loading")) return; // wait for compression
      const images = staged.flatMap((p) =>
        p.status === "ready" ? [{ data: p.data, mediaType: p.mediaType }] : [],
      );
      if (!c || !path || (!trimmed && images.length === 0)) return;
      const ts = Date.now();
      mutatePending(() => []);
      setImageHint("");
      void (async () => {
        let imageNames: string[] = [];
        if (images.length > 0) {
          try {
            imageNames = await saveThreadImages(c.threadId, images);
          } catch (e) {
            console.error("failed to persist pasted images", e);
            pushToast("warn", "Pasted image could not be saved");
            mutatePending(() => staged); // give them back so the send can be retried
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
        appendMessage(path, c.threadId, persistMsg);
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
    [runTurn, mutatePending, pushToast],
  );

  // Retry the last (failed) turn.
  const retryCall = useCallback(() => {
    const c = callRef.current;
    if (c) runTurn(c.threadId, c.annotationId);
  }, [runTurn]);

  // Stop a streaming turn and keep what it wrote: the abort silences the agent
  // (no onDone/onError follows), so persisting the partial here is the only way
  // it survives a reopen. Nothing generated yet → drop the empty reply.
  const stopTurn = useCallback(() => {
    const c = callRef.current;
    const path = pathRef.current;
    abortRef.current?.abort();
    abortRef.current = null;
    if (!c || !path) return;
    const streamingMsg = [...c.messages].reverse().find((m) => m.role === "ai" && m.streaming);
    if (!streamingMsg) return;
    const { ts } = streamingMsg;
    const partial = partialRef.current.trim();
    partialRef.current = "";
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
    if (partial) appendMessage(path, c.threadId, { role: "ai", text: partial, ts });
  }, []);

  // Bubble → full-window chat (reading shrinks to the corner card).
  const expandCall = useCallback(() => setCall((c) => (c ? { ...c, view: "chat-main" } : c)), []);
  // The two picture-in-picture swaps.
  const swapToReading = useCallback(() => setCall((c) => (c ? { ...c, view: "chat-pip" } : c)), []);
  const swapToChat = useCallback(() => setCall((c) => (c ? { ...c, view: "chat-main" } : c)), []);
  // Hangup bookkeeping (docs/02, docs/03): log the end of the conversation and
  // kick the silent memory distillation over its persisted transcript. Reads
  // refs so it is stable; no-ops when nothing is open. Distillation runs in the
  // background with no UI — the memory panel shows when it last ran.
  const captureHangup = useCallback(() => {
    const c = callRef.current;
    const path = pathRef.current;
    const { topicId, topicName, fileName, pageIndex } = ctxRef.current;
    if (!c || !path || !topicId) return;
    logEvent(topicId, "call-end", { threadId: c.threadId, book: c.isBook ?? false });
    const msgs = getThread(path, c.threadId)?.messages ?? [];
    const ann = annsRef.current.get(c.annotationId);
    void distillThread({
      topicId,
      topicName,
      bookName: fileName,
      threadId: c.threadId,
      annotationId: c.annotationId,
      // The book-level thread has no mark: pin its position to the current page.
      page: c.isBook
        ? pageIndex !== null
          ? pageIndex + 1
          : null
        : annotationPage(ann as { position?: { pageIndex?: number } } | undefined),
      markedText: c.isBook ? "" : typeof ann?.text === "string" ? ann.text : "",
      messages: msgs.map(({ role, text, ts }) => ({ role, text, ts })),
    });
  }, []);

  // ✕ hangs up, and touching the book dismisses too: the view goes away (the
  // stream is aborted), the thread stays on its mark (docs/03).
  const endCall = useCallback(() => {
    captureHangup();
    abortRef.current?.abort();
    abortRef.current = null;
    setCall(null);
    clearPendingImages();
  }, [clearPendingImages, captureHangup]);

  const openThreadForAnnotation = useCallback(
    (annotationId: string) => {
      const ann = annsRef.current.get(annotationId);
      const threadId = ann?.aiThreadId as string | undefined;
      const path = pathRef.current;
      if (!threadId || !path) return;
      const thread = getThread(path, threadId);
      abortRef.current?.abort();
      viewRef.current?.selectAnnotations([annotationId]);
      viewRef.current?.navigate({ annotationID: annotationId });
      setSelectedAnnId(annotationId);
      const msgs = thread?.messages ?? [];
      setCall({ threadId, annotationId, view: "chat-main", anchor: { x: 0, y: 0 }, messages: toDisplayMessages(msgs) });
      hydrateThreadImages(threadId, msgs);
      if (msgs.length === 0) runTurn(threadId, annotationId);
    },
    [runTurn, hydrateThreadImages],
  );

  // Top-bar AI button: the selection-free entry (docs/03). One persistent
  // book-level thread per book — created on first press, reopened with its
  // history on later presses (and after hangup), the way a mark hosts its
  // thread. It has no anchor, so it never joins the trace list; this button is
  // its only way back. Opens straight to the main call view, skipping the bubble.
  const openBookThread = useCallback(() => {
    const path = pathRef.current;
    if (!path) return;
    const thread = getBookThread(path) ?? createBookThread(path, crypto.randomUUID());
    abortRef.current?.abort();
    setPopup(null);
    const msgs = thread.messages;
    setCall({
      threadId: thread.id,
      annotationId: "",
      isBook: true,
      view: "chat-main",
      anchor: { x: 0, y: 0 },
      messages: toDisplayMessages(msgs),
    });
    hydrateThreadImages(thread.id, msgs);
    if (msgs.length === 0) runTurn(thread.id, "");
  }, [runTurn, hydrateThreadImages]);

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
    // Closing the book with a call open ends that conversation too.
    captureHangup();
    abortRef.current?.abort();
    abortRef.current = null;
    setCall(null);
    clearPendingImages();
    setTitle(null);
    setPopup(null);
    setFulltext(null);
    setFulltextPending(false);
    setEmbedDoc(null);
    // Detach the prep UI; the pipeline keeps prepping in the background.
    setClassroomOn(false);
    setSelectedPrepSlug(null);
    prepUnsubRef.current?.();
    prepUnsubRef.current = null;
    pipelineRef.current = null;
    setPrepSnap(null);
    pathRef.current = null;
    viewRef.current = null;
    pageDwellRef.current = null;
  }, [clearPendingImages, captureHangup]);

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
        else if (callRef.current) endCall();
        else if (popup) setPopup(null);
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
  }, [showSettings, popup, endCall]);

  const pageText = stats ? `${stats.pageIndex + 1} / ${stats.pagesCount}` : "— / —";
  const twoPage = !!stats && stats.spreadMode !== SpreadMode.None;
  const inReader = !!title;
  const configured = !!(
    settings.defaultProviderId &&
    settings.defaultModelId &&
    providersInfo.find((p) => p.id === settings.defaultProviderId)?.configured
  );
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
        const path = pathRef.current;
        if (!buf || !path) return null;
        const r = await renderFigure(hashPath(path), buf, figure, "card");
        return r ? r.dataUrl : null;
      },
      onJump: (figure) => onCitation({ kind: "figure", id: figure.id }),
    };
  }, [figures, onCitation]);

  return (
    <CitationContext.Provider value={onCitation}>
    <FigureContext.Provider value={figureHost}>
    <div className="flex flex-col h-full">
      {/* z-10: the color palette drops out of the header into the reader area,
          and <main> is positioned too — without this it would paint over it. */}
      <header className="relative z-10 flex h-11 flex-none items-center gap-3 border-b border-[#dcdcdc] bg-[#fafafa] px-3">
        {/* The pen rack is centered on the window, independent of how long the
            file path or the zoom controls are. */}
        {inReader && (
          <div className="absolute left-1/2 top-0 z-[1] flex h-11 -translate-x-1/2 items-center">
            <PenToolbar
              orientation="horizontal"
              tool={{ type: toolType, color: penColor }}
              colors={ANNOTATION_COLORS}
              onToolChange={(t) => {
                setToolType(t.type);
                setPenColor(t.color);
              }}
            />
          </div>
        )}
        {inReader ? (
          <>
            <button className={BTN} onClick={closeReader}>
              ‹ Library
            </button>
            <span className="text-[13px] text-[#1b1b1b] overflow-hidden text-ellipsis whitespace-nowrap max-w-[max(160px,calc(50vw-330px))]">
              {activeTopic?.name} <span className="text-[#777] mx-0.5">›</span> {title}
            </span>
            {status && <span className="ml-3 text-xs text-[#b45309]">{status}</span>}
            <span className="flex-1" />
            <div className="flex items-center gap-2">
              <button
                className="flex items-center justify-center rounded-md border border-[#c9c2e8] bg-[#efecfb] px-2.5 py-1.5 text-[#4a3a9e] cursor-pointer hover:bg-[#e7e3f7]"
                title="Talk about this book"
                aria-label="Talk about this book"
                onClick={openBookThread}
              >
                <IconSparkle size={16} />
              </button>
              <span className="h-5 w-px bg-[#dcdcdc]" />
              <button className={BTN} disabled={!stats?.canZoomOut} onClick={() => viewRef.current?.zoomOut()}>
                −
              </button>
              <span className="[font-variant-numeric:tabular-nums] text-[13px] min-w-[64px] text-center">{pageText}</span>
              <button className={BTN} disabled={!stats?.canZoomIn} onClick={() => viewRef.current?.zoomIn()}>
                +
              </button>
              <span className="h-5 w-px bg-[#dcdcdc]" />
              <button
                className={BTN_SM}
                title="Fit page width"
                disabled={!stats?.canZoomReset}
                onClick={() => viewRef.current?.zoomReset()}
              >
                Fit width
              </button>
              <button
                className={twoPage ? BTN_SM_ON : BTN_SM}
                title="Two-page spread"
                aria-pressed={twoPage}
                disabled={!viewReady}
                onClick={() =>
                  viewRef.current?.setSpreadMode(twoPage ? SpreadMode.None : SpreadMode.Odd)
                }
              >
                Two pages
              </button>
            </div>
          </>
        ) : (
          <>
            {activeTopic ? (
              <button className={BTN} onClick={() => setActiveTopicId(null)}>
                ‹ Topics
              </button>
            ) : (
              <span className="text-[13px] text-[#777] overflow-hidden text-ellipsis whitespace-nowrap max-w-[40vw]">Reading Partner</span>
            )}
            {activeTopic && <span className="text-[13px] text-[#1b1b1b] overflow-hidden text-ellipsis whitespace-nowrap max-w-[40vw]">{activeTopic.name}</span>}
            <span className="flex-1" />
          </>
        )}
        <button className={BTN} title="Settings" aria-label="Settings" onClick={() => setShowSettings(true)}>
          ⚙
        </button>
      </header>

      <main className="relative flex-1 min-h-0 flex">
        {/* Sidebar sits on the LEFT (Zotero iPad Annotations position); the
            right side is reserved for the future AI column. */}
        {inReader && (
          <Sidebar
            open={sidebarOpen}
            tab={sidebarTab}
            onToggle={() => setSidebarOpen((v) => !v)}
            onSelectTab={(t) => {
              if (t === sidebarTab && sidebarOpen) {
                setSidebarOpen(false);
              } else {
                if (t === "memory" && activeTopic) logEvent(activeTopic.id, "memory-tab-open");
                setSidebarTab(t);
                setSidebarOpen(true);
              }
            }}
            fulltext={fulltext}
            fulltextPending={fulltextPending}
            onNavigatePage={(page) => viewRef.current?.navigate({ pageIndex: page - 1 })}
            annotations={traceAnns as unknown as PopupAnnotation[]}
            selectedId={selectedAnnId}
            onSelectAnnotation={onTraceSelect}
            onToggleStar={(id, starred) => patchAnnotation(id, { starred })}
            onOpenThread={openThreadForAnnotation}
            prepPanel={
              <PrepPanel
                snapshot={prepSnap}
                loadNote={loadPrepNoteBody}
                onSkip={prepSkip}
                onRequeue={prepRequeue}
                onAdd={prepAdd}
                onStartPrep={prepStart}
                onRetryPlan={prepRetryPlan}
                onReplan={prepReplan}
                selectedSlug={selectedPrepSlug}
              />
            }
            memoryPanel={<MemoryPanel entries={memEntries} lastDistilledAt={memLastDistill} />}
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
              key={embedDoc.path}
              buffer={embedDoc.buffer}
              annotations={embedDoc.annotations}
              authorName="Reading-Partner"
              viewState={embedDoc.viewState}
              className="h-full w-full block"
              onView={onEmbedView}
              onInitialized={onEmbedInitialized}
              onChangeViewState={persist}
              onChangeViewStats={setStats}
              onSaveAnnotations={onSaveAnnotations}
              onDeleteAnnotations={onDeleteAnnotations}
              // Native selection already happened — just reflect it (no echo,
              // which would loop through the engine's own selection state).
              onSelectAnnotations={onEmbedSelect}
              onSetAnnotationPopup={onSetAnnotationPopup}
            />
          )}
        </div>

        {!inReader && (
          <div className="absolute inset-0 flex flex-col items-stretch justify-start gap-6 bg-white overflow-y-auto">
            {activeTopic ? (
              <TopicDetail
                topic={activeTopic}
                onAddFile={addFile}
                onOpenFile={openFile}
                onRemoveFile={async (p) => {
                  await removeFileFromTopic(activeTopic.id, p);
                  await refreshTopics();
                }}
              />
            ) : (
              <TopicLibrary
                topics={topics}
                newTopicName={newTopicName}
                setNewTopicName={setNewTopicName}
                renamingId={renamingId}
                renameText={renameText}
                setRenameText={setRenameText}
                onCreate={async () => {
                  if (!newTopicName.trim()) return;
                  await createTopic(newTopicName);
                  setNewTopicName("");
                  await refreshTopics();
                }}
                onStartRename={(t) => {
                  setRenamingId(t.id);
                  setRenameText(t.name);
                }}
                onCommitRename={async () => {
                  if (renamingId) await renameTopic(renamingId, renameText);
                  setRenamingId(null);
                  await refreshTopics();
                }}
                onDelete={async (t) => {
                  if (!window.confirm(`Delete topic "${t.name}"? Files stay on disk.`)) return;
                  await deleteTopic(t.id);
                  await refreshTopics();
                }}
                onOpen={(t) => setActiveTopicId(t.id)}
              />
            )}
          </div>
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
            onExpand={expandCall}
            onClose={endCall}
            pendingImages={pendingImages}
            onRemoveImage={removePendingImage}
            hint={imageHint}
            streaming={streaming}
            onStop={stopTurn}
          />
        )}

        {/* No provider configured: guide to Settings instead of chatting. */}
        {showGuidance && call && (
          <div
            className="fixed z-[1000] flex w-[300px] flex-col gap-3 rounded-xl border border-black/10 bg-white p-4 shadow-[0_8px_40px_rgba(0,0,0,0.18)]"
            style={{
              left: Math.max(8, Math.min(call.anchor.x - 150, window.innerWidth - 308)),
              top: Math.max(8, Math.min(call.anchor.y + 10, window.innerHeight - 160)),
            }}
          >
            <p className="m-0 text-sm text-neutral-700">Configure a provider in Settings to start chatting.</p>
            <div className="flex justify-end gap-2">
              <button className={BTN} onClick={endCall}>
                Dismiss
              </button>
              <button className={BTN_PRIMARY} onClick={() => setShowSettings(true)}>
                Open Settings
              </button>
            </div>
          </div>
        )}

        {/* A failed turn stays visible; offer a retry (docs/03: errors not swallowed). */}
        {call?.error && (
          <button
            className="fixed bottom-6 left-1/2 z-[1001] -translate-x-1/2 rounded-full border border-[#dcdcdc] bg-white px-4 py-1.5 text-sm shadow-md hover:bg-[#f0f0f0]"
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
              />
            </div>
            <div className="absolute right-3 top-3 z-50">
              <ReadingPipCard
                fileName={title ?? ""}
                pageLabel={stats?.pageLabel ?? null}
                excerpt={callExcerpt(annsRef.current.get(call.annotationId)) || null}
                onClick={() => {
                  onPositionClick();
                  swapToReading();
                }}
              />
            </div>
          </>
        )}

        {/* chat-pip: reading is back; the call persists as the corner chat card. */}
        {call?.view === "chat-pip" && (
          <div className="absolute right-3 top-3 z-50">
            <ChatPipCard
              lastMessage={call.messages.length ? call.messages[call.messages.length - 1].text : null}
              onClick={swapToChat}
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
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
    </FigureContext.Provider>
    </CitationContext.Provider>
  );
}

function callExcerpt(ann: Annotation | undefined): string {
  if (!ann) return "";
  if (typeof ann.text === "string" && ann.text) return ann.text;
  if (typeof ann.comment === "string" && ann.comment) return ann.comment;
  return "";
}

// An annotation flattened for the read_annotations tool: 1-based page + selected
// text + comment. Skips annotations with neither text nor comment (e.g. legacy
// image regions).
function toAnnotationLite(ann: Annotation): AnnotationLite | null {
  const text = typeof ann.text === "string" ? ann.text.trim() : "";
  const comment = typeof ann.comment === "string" ? ann.comment.trim() : "";
  if (!text && !comment) return null;
  return { page: annotationPage(ann as { position?: { pageIndex?: number } }), text, comment };
}

// Assemble the topic's materials for a call (M6): each file's cached full text
// and its annotations, scoped to the active topic. The current book uses the
// in-memory annotations and the just-extracted full text; other books read from
// the cache/disk (never re-extracted here, so they show only if opened before).
async function gatherTopicMaterials(
  files: { path: string; name: string }[],
  currentPath: string,
  currentFulltext: Fulltext | null,
  currentAnns: Annotation[],
): Promise<(TopicMaterial & { path: string })[]> {
  const out: (TopicMaterial & { path: string })[] = [];
  for (const f of files) {
    const isCurrent = f.path === currentPath;
    let fulltext: Fulltext | null;
    if (isCurrent) fulltext = currentFulltext;
    else {
      try {
        fulltext = await getFulltext(hashPath(f.path));
      } catch {
        fulltext = null;
      }
    }
    let anns: Annotation[];
    if (isCurrent) anns = currentAnns;
    else {
      try {
        anns = await loadAnnotations(f.path);
      } catch {
        anns = [];
      }
    }
    const annotations = anns
      .map(toAnnotationLite)
      .filter((a): a is AnnotationLite => a !== null);
    out.push({ path: f.path, label: f.name, fulltext, annotations });
  }
  return out;
}

function TopicLibrary(props: {
  topics: Topic[];
  newTopicName: string;
  setNewTopicName: (v: string) => void;
  renamingId: string | null;
  renameText: string;
  setRenameText: (v: string) => void;
  onCreate: () => void;
  onStartRename: (t: Topic) => void;
  onCommitRename: () => void;
  onDelete: (t: Topic) => void;
  onOpen: (t: Topic) => void;
}) {
  return (
    <div className={LIBRARY}>
      <h1 className="mt-0 mb-5 mx-0 text-[22px]">Topics</h1>
      <div className="flex gap-2 mb-5">
        <input
          className={INPUT}
          placeholder="New topic (e.g. what makes JITs fast)"
          value={props.newTopicName}
          onChange={(e) => props.setNewTopicName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && props.onCreate()}
        />
        <button className={BTN} onClick={props.onCreate}>
          Add
        </button>
      </div>
      {props.topics.length === 0 && <p className="text-[#777] text-sm">No topics yet. Create one to start reading.</p>}
      <ul className={TOPIC_LIST}>
        {props.topics.map((t) => (
          <li key={t.id} className={TOPIC_ROW}>
            {props.renamingId === t.id ? (
              <input
                className={INPUT}
                autoFocus
                value={props.renameText}
                onChange={(e) => props.setRenameText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && props.onCommitRename()}
                onBlur={props.onCommitRename}
              />
            ) : (
              <button className={TOPIC_NAME} onClick={() => props.onOpen(t)}>
                {t.name}
                <span className="text-xs text-[#777]">{t.files.length} file{t.files.length === 1 ? "" : "s"}</span>
              </button>
            )}
            <div className="flex gap-1">
              <button className={BTN_SM} onClick={() => props.onStartRename(t)}>
                Rename
              </button>
              <button className={BTN_SM_DANGER} onClick={() => props.onDelete(t)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Per-book reading metadata. `page`/`pages` are absent until the book has been
// opened at least once (no reading position, no full-text cache).
interface BookMeta {
  page?: number; // 1-based
  pages?: number;
  marks: number;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

function relativeTime(ts: number): string {
  const minutes = Math.floor((Date.now() - ts) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${plural(minutes, "minute")} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${plural(days, "day")} ago`;
  return new Date(ts).toLocaleDateString();
}

// Empty for a book that was never opened, which renders as no second line.
function metaLine(meta: BookMeta | undefined, lastOpenedAt?: number): string {
  const parts: string[] = [];
  if (meta?.page) {
    parts.push(meta.pages ? `Page ${meta.page} of ${meta.pages}` : `Page ${meta.page}`);
  }
  if (meta?.marks) parts.push(plural(meta.marks, "mark"));
  if (lastOpenedAt) parts.push(relativeTime(lastOpenedAt));
  return parts.join(" · ");
}

function TopicDetail(props: {
  topic: Topic;
  onAddFile: () => void;
  onOpenFile: (path: string, name: string) => void;
  onRemoveFile: (path: string) => void;
}) {
  const files = sortedFiles(props.topic);
  const [meta, setMeta] = useState<Record<string, BookMeta>>({});

  // Loaded off the render path, per file. Every read is optional: a book that
  // was never opened has no state, no full-text cache and no annotation file,
  // and that is the normal case, not an error.
  useEffect(() => {
    let cancelled = false;
    const paths = props.topic.files.map((f) => f.path);
    void Promise.all(
      paths.map(async (path): Promise<[string, BookMeta]> => {
        const [state, fulltext, annotations] = await Promise.all([
          getViewState(path).catch(() => null),
          getFulltext(hashPath(path)).catch(() => null),
          loadAnnotations(path).catch(() => []),
        ]);
        return [
          path,
          {
            page: state ? state.pageIndex + 1 : undefined,
            pages: fulltext?.pages.length || undefined,
            marks: annotations.length,
          },
        ];
      }),
    ).then((entries) => {
      if (!cancelled) setMeta(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [props.topic]);

  return (
    <div className={LIBRARY}>
      <div className="flex items-center justify-between mb-4">
        <h1 className="m-0 text-[22px]">{props.topic.name}</h1>
        <button className={BTN} onClick={props.onAddFile}>
          Add PDF
        </button>
      </div>
      {files.length === 0 && <p className="text-[#777] text-sm">No files yet. Add a PDF to this topic.</p>}
      <ul className={TOPIC_LIST}>
        {files.map((f) => {
          const line = metaLine(meta[f.path], f.lastOpenedAt);
          return (
            <li key={f.path} className={TOPIC_ROW}>
              <button className={TOPIC_NAME} onClick={() => props.onOpenFile(f.path, f.name)}>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate">{f.name}</span>
                  {line && <span className="text-xs text-[#777]">{line}</span>}
                </span>
              </button>
              <div className="flex gap-1">
                <button className={BTN_SM_DANGER} onClick={() => props.onRemoveFile(f.path)}>
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
