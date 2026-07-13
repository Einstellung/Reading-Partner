import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  createPdfView,
  type Annotation,
  type AnnotationPopupParams,
  type ViewInstance,
  type ViewState,
  type ViewStats,
} from "./reader";
import { getViewState, saveViewState } from "./storage";
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
  createThread,
  getThread,
  loadThreads,
  onThreadSaveError,
  readThreadImages,
  saveThreadImages,
  type ThreadMessage,
} from "./threads";
import { compressImage, type CompressedImage } from "./ai/image-utils";
import { loadSettings, onSettingsSaveError, saveSettings, type Settings } from "./settings";
import { buildSystemPrompt } from "./context";
import {
  installFetchBridge,
  listProviders,
  modelSupportsImages,
  streamChat,
  type ProviderId,
  type ProviderInfo,
} from "./aiClient";
import PenToolbar from "./components/PenToolbar";
import AnnotationPopup from "./components/AnnotationPopup";
import TraceList from "./components/TraceList";
import CallBubble from "./components/CallBubble";
import CallView from "./components/CallView";
import ReadingPipCard from "./components/ReadingPipCard";
import ChatPipCard from "./components/ChatPipCard";
import SettingsView from "./components/SettingsView";
import type { Annotation as PopupAnnotation, ToolType } from "./components/types";

const HOST_SRC = "/reader/reader-host.html";
// Auto-explanation kickoff (docs/03: the bubble starts explaining, unprompted).
const EXPLAIN_KICKOFF = "Please explain the passage I just marked, using the reading context above.";
// The AI pen maps to the engine's underline tool in a fixed purple. Owning this
// one color for the AI pen is a v1 implementation convenience, not a semantic in
// the color palette; the host identifies AI-pen strokes by the active tool, not
// the color. Value is `general-purple` from vendor/reader defines.js.
const AI_PEN_COLOR = "#a28ae5";
// Cap on images attached to one chat turn (docs/03: paste screenshots to ask).
const MAX_PENDING_IMAGES = 3;

// Shared utility-class strings for the shell chrome (migrated from styles.css).
// Split so variant overrides never collide with base padding/border utilities.
const BTN_BASE =
  "leading-none border rounded-md bg-white cursor-pointer enabled:hover:bg-[#f0f0f0] disabled:opacity-40 disabled:cursor-default";
const BTN = `${BTN_BASE} text-sm px-3 py-1.5 border-[#dcdcdc]`;
const BTN_PRIMARY = "text-sm leading-none px-3 py-1.5 rounded-md bg-[#6c4fd0] text-white cursor-pointer enabled:hover:bg-[#5a3fbf] disabled:opacity-40";
const BTN_SM = `${BTN_BASE} text-xs px-2 py-1 border-[#dcdcdc]`;
const BTN_SM_DANGER = `${BTN_BASE} text-xs px-2 py-1 border-[#f0c8c8] text-[#b91c1c]`;
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
};

// Persisted thread messages -> display messages. Image bytes are loaded
// separately (hydrateThreadImages), so images start absent here.
function toDisplayMessages(msgs: ThreadMessage[]): CallMessage[] {
  return msgs.map((m) => ({ role: m.role, text: m.text, ts: m.ts }));
}

// A live AI "call" — one thread anchored on one AI-pen underline (docs/03).
interface CallState {
  threadId: string;
  annotationId: string;
  // Picture-in-picture call states (docs/03): the bubble, chat taking the whole
  // window (reading shrunk to a corner card), and reading with chat shrunk to a
  // corner card. `null` call = no active call.
  view: "bubble" | "chat-main" | "chat-pip";
  anchor: { x: number; y: number };
  messages: CallMessage[];
  error?: boolean; // last turn failed (offer retry)
}

export default function App() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const viewRef = useRef<ViewInstance | null>(null);
  const pathRef = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const lastState = useRef<ViewState | null>(null);

  // Annotations for the open document, keyed by id for merge-on-save.
  const annsRef = useRef<Map<string, Annotation>>(new Map());
  // Whether the active pen is the AI pen (host-owned; not inferred from color).
  const aiPenRef = useRef(false);
  // Current call view, mirrored for the pdf-iframe pointerdown listener (which
  // can't read React state directly).
  const callViewRef = useRef<"none" | "bubble" | "chat-main" | "chat-pip">("none");
  // Last pen-lift position inside the pdf iframe — the AI-pen bubble anchor,
  // since drawing a pen stroke yields no popup coordinates (pitfall: see report).
  const penUpRef = useRef<{ clientX: number; clientY: number } | null>(null);
  // Abort controller for the in-flight stream (cancelled on hangup / switch).
  const abortRef = useRef<AbortController | null>(null);
  // Refs read by the stable runTurn callback (avoids dependency churn).
  const settingsRef = useRef<Settings>({ defaultProviderId: null, defaultModelId: null });
  const ctxRef = useRef<{ topicName: string; fileName: string; pageLabel: string | null }>({
    topicName: "",
    fileName: "",
    pageLabel: null,
  });

  const [topics, setTopics] = useState<Topic[]>([]);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [newTopicName, setNewTopicName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

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
  const [call, setCall] = useState<CallState | null>(null);
  const [settings, setSettings] = useState<Settings>({ defaultProviderId: null, defaultModelId: null });
  const [showSettings, setShowSettings] = useState(false);
  const [providersInfo, setProvidersInfo] = useState<ProviderInfo[]>([]);

  // Images pasted into the composer, awaiting send. Mirrored to a ref so the
  // stable send handler reads the current list. A single document-level paste
  // listener (below) fills these; the composer only renders them (controlled).
  const [pendingImages, setPendingImages] = useState<CompressedImage[]>([]);
  const pendingImagesRef = useRef<CompressedImage[]>([]);
  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);
  // Inline note under the composer when a paste is rejected (model can't see it).
  const [imageHint, setImageHint] = useState("");

  // Mirror the call (view for the pdf listener, whole thing for send handlers).
  const callRef = useRef<CallState | null>(null);
  useEffect(() => {
    callViewRef.current = call?.view ?? "none";
    callRef.current = call;
  }, [call]);

  // Install the Tauri fetch bridge + load settings once.
  useEffect(() => {
    installFetchBridge();
    loadSettings().then(setSettings).catch(() => {});
    onSettingsSaveError((e) => {
      console.error("failed to persist settings", e);
      setStatus("Warning: settings could not be saved");
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
      topicName: activeTopic?.name ?? "",
      fileName: title ?? "",
      pageLabel: stats?.pageLabel ?? null,
    };
  });

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
      setStatus("Warning: annotations could not be saved");
    });
    onThreadSaveError((e) => {
      console.error("failed to persist thread", e);
      setStatus("Warning: AI conversation could not be saved");
    });
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
        setStatus("Warning: reading position could not be saved");
      });
    }, 500);
  }, []);

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

    const ann = annsRef.current.get(annotationId);
    const systemPrompt = buildSystemPrompt({
      topicName: ctxRef.current.topicName,
      fileName: ctxRef.current.fileName,
      pageLabel: ctxRef.current.pageLabel,
      selectionText: typeof ann?.text === "string" ? ann.text : "",
      selectionComment: typeof ann?.comment === "string" ? ann.comment : undefined,
    });
    const ts = Date.now();
    setCall((c) => {
      if (!c || c.threadId !== threadId) return c;
      const kept = c.messages.filter((m) => !(m.role === "ai" && (m.failed || m.streaming)));
      return { ...c, error: false, messages: [...kept, { role: "ai", text: "", ts, streaming: true }] };
    });

    // Thread messages store images as filenames; the model needs base64, so read
    // them back before streaming. Kept out of render so the placeholder shows
    // immediately.
    void (async () => {
      const prior = await Promise.all(
        (getThread(path, threadId)?.messages ?? []).map(async (m) => ({
          role: m.role,
          text: m.text,
          images: m.images?.length ? await readThreadImages(threadId, m.images) : undefined,
        })),
      );
      if (controller.signal.aborted) return;
      const apiMessages = [{ role: "user" as const, text: EXPLAIN_KICKOFF }, ...prior];

      streamChat({
        providerId: s.defaultProviderId as ProviderId,
        modelId: s.defaultModelId as string,
        systemPrompt,
        messages: apiMessages,
        signal: controller.signal,
        onDelta: (chunk) => patch((m) => ({ ...m, text: m.text + chunk }), ts),
        onDone: (full) => {
          patch(() => ({ role: "ai", text: full, ts }), ts);
          appendMessage(path, threadId, { role: "ai", text: full, ts });
          if (abortRef.current === controller) abortRef.current = null;
        },
        onError: (message: string) => {
          if (abortRef.current === controller) abortRef.current = null;
          if (controller.signal.aborted) return; // switch/hangup, not a failure
          console.error("stream failed", message);
          setStatus("Warning: AI reply failed");
          patch(() => ({ role: "ai", text: `⚠️ Couldn't reach the model. ${message}`, ts, failed: true }), ts, true);
        },
      });
    })();
  }, []);

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
        const rect = iframeRef.current?.getBoundingClientRect();
        const up = penUpRef.current;
        const anchor =
          up && rect
            ? { x: rect.left + up.clientX, y: rect.top + up.clientY }
            : { x: (rect?.left ?? 0) + 240, y: (rect?.top ?? 0) + 240 };
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

  // Clicking a mark. Anchor is in the shell's viewport (engine rect is
  // iframe-local, add the iframe offset). An AI-pen mark (has aiThreadId) opens
  // its call bubble with history instead of the annotation editor.
  const onSetAnnotationPopup = useCallback((params?: AnnotationPopupParams) => {
    if (!params) {
      setPopup(null);
      return;
    }
    const rect = iframeRef.current?.getBoundingClientRect();
    const dx = rect?.left ?? 0;
    const dy = rect?.top ?? 0;
    const [l, , r, bottom] = params.rect;
    const anchor = { x: dx + (l + r) / 2, y: dy + bottom };
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

  const reloadFrame = useCallback(async () => {
    const iframe = iframeRef.current;
    if (!iframe) throw new Error("no iframe");
    await new Promise<void>((resolve) => {
      const onLoad = () => {
        iframe.removeEventListener("load", onLoad);
        resolve();
      };
      iframe.addEventListener("load", onLoad);
      iframe.src = `${HOST_SRC}?n=${Date.now()}`;
    });
    return iframe;
  }, []);

  // The pen stroke gives the host no coordinates, so track the last pen-lift
  // inside the same-origin pdf iframe as the AI-pen bubble anchor. Re-installed
  // per open (the pdf iframe may not exist yet when the view initializes).
  const installPenUpAnchor = useCallback(() => {
    const attach = (attempt: number) => {
      const host = iframeRef.current?.contentDocument;
      const pdf = host?.querySelector("#view iframe") as HTMLIFrameElement | null;
      const doc = pdf?.contentDocument;
      if (!doc) {
        if (attempt < 20) window.setTimeout(() => attach(attempt + 1), 150);
        return;
      }
      doc.addEventListener(
        "pointerup",
        (e) => {
          penUpRef.current = { clientX: (e as PointerEvent).clientX, clientY: (e as PointerEvent).clientY };
        },
        true,
      );
      // Touching the book dismisses the bubble / chat corner card (docs/03).
      // A pdf-area click stays inside the iframe, so B's outside-click listeners
      // never see it — this is the only place that catches it. chat-main is not
      // dismissable this way (CallView covers the reader). AI-pen draws and
      // mark clicks fire this on pointerdown, then re-open on save/pointerup.
      doc.addEventListener(
        "pointerdown",
        () => {
          if (callViewRef.current === "bubble" || callViewRef.current === "chat-pip") {
            setCall(null);
          }
        },
        true,
      );
    };
    attach(0);
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
        setStatus("Warning: saved annotations could not be loaded");
      }
      try {
        await loadThreads(path);
      } catch (e) {
        console.error("failed to load threads", e);
        setStatus("Warning: saved AI conversations could not be loaded");
      }
      annsRef.current = new Map(saved.map((a) => [a.id, a]));
      setTraceAnns(saved);

      setViewReady(false);
      const iframe = await reloadFrame();
      pathRef.current = path;
      const view = await createPdfView(iframe, bytes.buffer as ArrayBuffer, {
        type: "pdf",
        annotations: saved,
        authorName: "Reading-Partner",
        viewState: state,
        onChangeViewState: persist,
        onChangeViewStats: setStats,
        onSaveAnnotations,
        onDeleteAnnotations,
        // Feed the selection back or the click-to-open popup never fires (pitfall 05).
        onSelectAnnotations: (ids) => {
          viewRef.current?.selectAnnotations(ids);
          setSelectedAnnId(ids[0] ?? null);
        },
        onSetAnnotationPopup,
        onInitialized: () => {
          setStatus("");
          setViewReady(true);
          installPenUpAnchor();
        },
      });
      viewRef.current = view;
      setTitle(name);
    },
    [reloadFrame, persist, onSaveAnnotations, onDeleteAnnotations, onSetAnnotationPopup, installPenUpAnchor],
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
        setStatus("Can't open this file — it may have been moved or deleted.");
      }
    },
    [activeTopicId, openInReader, refreshTopics],
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

  // Compress a pasted image and stage it for the next send (capped at 3).
  const addPastedImage = useCallback(async (blob: Blob) => {
    try {
      const img = await compressImage(blob);
      setPendingImages((cur) => (cur.length >= MAX_PENDING_IMAGES ? cur : [...cur, img]));
    } catch (e) {
      console.error("failed to process pasted image", e);
      setStatus(e instanceof Error ? e.message : "Couldn't process that image");
    }
  }, []);

  const removePendingImage = useCallback((index: number) => {
    setPendingImages((cur) => cur.filter((_, i) => i !== index));
  }, []);

  const clearPendingImages = useCallback(() => {
    setPendingImages([]);
    setImageHint("");
  }, []);

  // One global paste path (docs: single owner, focus-independent). While a call
  // is open, an image on the clipboard is staged; a plain-text paste is left
  // untouched so typing is normal. Rejected up front if the model can't see
  // images, with an inline note rather than a silent drop downstream.
  useEffect(() => {
    if (!call) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const blobs: Blob[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) blobs.push(f);
        }
      }
      if (blobs.length === 0) return; // plain text: keep default paste
      e.preventDefault();
      const s = settingsRef.current;
      const canAttach = !!(
        s.defaultProviderId &&
        s.defaultModelId &&
        modelSupportsImages(s.defaultProviderId as ProviderId, s.defaultModelId)
      );
      if (!canAttach) {
        setImageHint("This model can't read images. Switch to a vision model in Settings.");
        return;
      }
      setImageHint("");
      for (const b of blobs) void addPastedImage(b);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [call, addPastedImage]);

  // Sending appends the user line (with any staged images, persisted to disk)
  // then streams the assistant reply. An empty message with images is allowed.
  const sendCallMessage = useCallback(
    (text: string) => {
      const c = callRef.current;
      const path = pathRef.current;
      const images = pendingImagesRef.current;
      const trimmed = text.trim();
      if (!c || !path || (!trimmed && images.length === 0)) return;
      const ts = Date.now();
      setPendingImages([]);
      setImageHint("");
      void (async () => {
        let imageNames: string[] = [];
        if (images.length > 0) {
          try {
            imageNames = await saveThreadImages(c.threadId, images);
          } catch (e) {
            console.error("failed to persist pasted images", e);
            setStatus("Warning: pasted image could not be saved");
            setPendingImages(images); // give them back so the send can be retried
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
    [runTurn],
  );

  // Retry the last (failed) turn.
  const retryCall = useCallback(() => {
    const c = callRef.current;
    if (c) runTurn(c.threadId, c.annotationId);
  }, [runTurn]);

  // Bubble → full-window chat (reading shrinks to the corner card).
  const expandCall = useCallback(() => setCall((c) => (c ? { ...c, view: "chat-main" } : c)), []);
  // The two picture-in-picture swaps.
  const swapToReading = useCallback(() => setCall((c) => (c ? { ...c, view: "chat-pip" } : c)), []);
  const swapToChat = useCallback(() => setCall((c) => (c ? { ...c, view: "chat-main" } : c)), []);
  // ✕ hangs up, and touching the book dismisses too: the view goes away (the
  // stream is aborted), the thread stays on its mark (docs/03).
  const endCall = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setCall(null);
    clearPendingImages();
  }, [clearPendingImages]);

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

  // Jump the reading back to the thread's mark (from the reading corner card).
  const onPositionClick = useCallback(() => {
    setCall((c) => {
      if (c) {
        viewRef.current?.selectAnnotations([c.annotationId]);
        viewRef.current?.navigate({ annotationID: c.annotationId });
      }
      return c;
    });
  }, []);

  const closeReader = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setCall(null);
    clearPendingImages();
    setTitle(null);
    setPopup(null);
    pathRef.current = null;
    viewRef.current = null;
  }, [clearPendingImages]);

  const pageText = stats ? `${stats.pageIndex + 1} / ${stats.pagesCount}` : "— / —";
  const inReader = !!title;
  const configured = !!(
    settings.defaultProviderId &&
    settings.defaultModelId &&
    providersInfo.find((p) => p.id === settings.defaultProviderId)?.configured
  );
  const showGuidance = call?.view === "bubble" && call.messages.length === 0 && !configured;

  return (
    <div className="flex flex-col h-full">
      <header className="flex h-11 flex-none items-center gap-3 border-b border-[#dcdcdc] bg-[#fafafa] px-3">
        {inReader ? (
          <>
            <button className={BTN} onClick={closeReader}>
              ‹ Library
            </button>
            <button className={BTN} onClick={() => setSidebarOpen((v) => !v)}>
              Traces
            </button>
            <span className="text-[13px] text-[#1b1b1b] overflow-hidden text-ellipsis whitespace-nowrap max-w-[40vw]">
              {activeTopic?.name} <span className="text-[#777] mx-0.5">›</span> {title}
            </span>
            {status && <span className="ml-3 text-xs text-[#b45309]">{status}</span>}
            <span className="flex-1" />
            <div className="flex items-center gap-2">
              <button className={BTN} disabled={!stats?.canZoomOut} onClick={() => viewRef.current?.zoomOut()}>
                −
              </button>
              <span className="[font-variant-numeric:tabular-nums] text-[13px] min-w-[64px] text-center">{pageText}</span>
              <button className={BTN} disabled={!stats?.canZoomIn} onClick={() => viewRef.current?.zoomIn()}>
                +
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
        {/* Trace panel sits on the LEFT (Zotero iPad Annotations position);
            the right side is reserved for the future AI column. */}
        {inReader && sidebarOpen && (
          <aside className="w-[300px] shrink-0 h-full overflow-y-auto border-r border-[#dcdcdc] bg-white">
            <TraceList
              annotations={traceAnns as unknown as PopupAnnotation[]}
              selectedId={selectedAnnId}
              onSelect={onTraceSelect}
              onToggleStar={(id, starred) => patchAnnotation(id, { starred })}
              onOpenThread={openThreadForAnnotation}
            />
          </aside>
        )}

        <iframe ref={iframeRef} className="flex-1 min-w-0 h-full border-0 block" src={HOST_SRC} title="reader" />

        {inReader && (
          <div className={`absolute top-3 z-[5] ${sidebarOpen ? "left-[312px]" : "left-3"}`}>
            <PenToolbar
              tool={{ type: toolType, color: penColor }}
              colors={ANNOTATION_COLORS}
              onToolChange={(t) => {
                setToolType(t.type);
                setPenColor(t.color);
              }}
            />
          </div>
        )}

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

      {showSettings && (
        <SettingsView
          settings={settings}
          onSettingsChange={applySettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

function callExcerpt(ann: Annotation | undefined): string {
  if (!ann) return "";
  if (typeof ann.text === "string" && ann.text) return ann.text;
  if (typeof ann.comment === "string" && ann.comment) return ann.comment;
  return "";
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

function TopicDetail(props: {
  topic: Topic;
  onAddFile: () => void;
  onOpenFile: (path: string, name: string) => void;
  onRemoveFile: (path: string) => void;
}) {
  const files = sortedFiles(props.topic);
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
        {files.map((f) => (
          <li key={f.path} className={TOPIC_ROW}>
            <button className={TOPIC_NAME} onClick={() => props.onOpenFile(f.path, f.name)}>
              {f.name}
            </button>
            <div className="flex gap-1">
              <button className={BTN_SM_DANGER} onClick={() => props.onRemoveFile(f.path)}>
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
