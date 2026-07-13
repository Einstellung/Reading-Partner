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
  type ThreadMessage,
} from "./threads";
import PenToolbar from "./components/PenToolbar";
import AnnotationPopup from "./components/AnnotationPopup";
import TraceList from "./components/TraceList";
import CallBubble from "./components/CallBubble";
import CallView from "./components/CallView";
import ReadingPipCard from "./components/ReadingPipCard";
import ChatPipCard from "./components/ChatPipCard";
import type { Annotation as PopupAnnotation, ToolType } from "./components/types";

const HOST_SRC = "/reader/reader-host.html";
// The AI pen maps to the engine's underline tool in a fixed purple. Owning this
// one color for the AI pen is a v1 implementation convenience, not a semantic in
// the color palette; the host identifies AI-pen strokes by the active tool, not
// the color. Value is `general-purple` from vendor/reader defines.js.
const AI_PEN_COLOR = "#a28ae5";

// Shared utility-class strings for the shell chrome (migrated from styles.css).
// Split so variant overrides never collide with base padding/border utilities.
const BTN_BASE =
  "leading-none border rounded-md bg-white cursor-pointer enabled:hover:bg-[#f0f0f0] disabled:opacity-40 disabled:cursor-default";
const BTN = `${BTN_BASE} text-sm px-3 py-1.5 border-[#dcdcdc]`;
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

// A live AI "call" — one thread anchored on one AI-pen underline (docs/03).
interface CallState {
  threadId: string;
  annotationId: string;
  // Picture-in-picture call states (docs/03): the bubble, chat taking the whole
  // window (reading shrunk to a corner card), and reading with chat shrunk to a
  // corner card. `null` call = no active call.
  view: "bubble" | "chat-main" | "chat-pip";
  anchor: { x: number; y: number };
  messages: ThreadMessage[];
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

  // Mirror the call view into a ref for the pdf-iframe pointerdown listener.
  useEffect(() => {
    callViewRef.current = call?.view ?? "none";
  }, [call]);

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

  // Engine created/modified annotations (drag-to-highlight, image select, etc.).
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
      }
    },
    [persistAnnotations, syncTraceList],
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
      setPopup(null);
      setCall({ threadId, annotationId: ann.id, view: "bubble", anchor, messages: thread?.messages ?? [] });
    } else {
      setPopup({ annotation: ann, anchor });
    }
  }, []);

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

  // Call handlers. Sending appends the user line plus a placeholder AI reply
  // (the model is wired in a later milestone) and persists both.
  const sendCallMessage = useCallback((text: string) => {
    const path = pathRef.current;
    if (!path || !text.trim()) return;
    setCall((c) => {
      if (!c) return c;
      const now = Date.now();
      const userMsg: ThreadMessage = { role: "user", text: text.trim(), ts: now };
      const aiMsg: ThreadMessage = {
        role: "ai",
        text: "[Placeholder] AI reply will appear here once the model is wired in.",
        ts: now + 1,
      };
      appendMessage(path, c.threadId, userMsg);
      appendMessage(path, c.threadId, aiMsg);
      return { ...c, messages: [...c.messages, userMsg, aiMsg] };
    });
  }, []);

  // Bubble → full-window chat (reading shrinks to the corner card).
  const expandCall = useCallback(() => setCall((c) => (c ? { ...c, view: "chat-main" } : c)), []);
  // The two picture-in-picture swaps.
  const swapToReading = useCallback(() => setCall((c) => (c ? { ...c, view: "chat-pip" } : c)), []);
  const swapToChat = useCallback(() => setCall((c) => (c ? { ...c, view: "chat-main" } : c)), []);
  // ✕ hangs up, and touching the book dismisses too: the view goes away, the
  // thread stays on its mark and is recalled by clicking the mark / ✨ (docs/03).
  const endCall = useCallback(() => setCall(null), []);

  const openThreadForAnnotation = useCallback((annotationId: string) => {
    const ann = annsRef.current.get(annotationId);
    const threadId = ann?.aiThreadId as string | undefined;
    const path = pathRef.current;
    if (!threadId || !path) return;
    const thread = getThread(path, threadId);
    viewRef.current?.selectAnnotations([annotationId]);
    viewRef.current?.navigate({ annotationID: annotationId });
    setSelectedAnnId(annotationId);
    setCall({ threadId, annotationId, view: "chat-main", anchor: { x: 0, y: 0 }, messages: thread?.messages ?? [] });
  }, []);

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
    setTitle(null);
    setPopup(null);
    pathRef.current = null;
    viewRef.current = null;
  }, []);

  const pageText = stats ? `${stats.pageIndex + 1} / ${stats.pagesCount}` : "— / —";
  const inReader = !!title;

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

        {call?.view === "bubble" && (
          <CallBubble
            anchor={call.anchor}
            messages={call.messages}
            onSend={sendCallMessage}
            onExpand={expandCall}
            onClose={endCall}
          />
        )}

        {/* chat-main: chat takes the whole window over the still-mounted reader
            (z-cover, reading state kept), reading shrinks to the corner card. */}
        {call?.view === "chat-main" && (
          <>
            <div className="absolute inset-0 z-40">
              <CallView messages={call.messages} onSend={sendCallMessage} onHangUp={endCall} />
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
