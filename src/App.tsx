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
  // Clicking outside the bubble keeps reading but the call stays alive as the
  // corner chat card — not a hang-up (docs/03 correction).
  const bubbleToPip = useCallback(() => setCall((c) => (c ? { ...c, view: "chat-pip" } : c)), []);
  // The two picture-in-picture swaps.
  const swapToReading = useCallback(() => setCall((c) => (c ? { ...c, view: "chat-pip" } : c)), []);
  const swapToChat = useCallback(() => setCall((c) => (c ? { ...c, view: "chat-main" } : c)), []);
  // ✕ hangs up: the view goes away, the thread stays on its mark.
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
    <div className="app">
      <header className="toolbar">
        {inReader ? (
          <>
            <button className="btn" onClick={closeReader}>
              ‹ Library
            </button>
            <button className={`btn${sidebarOpen ? " active" : ""}`} onClick={() => setSidebarOpen((v) => !v)}>
              Traces
            </button>
            <span className="crumb">
              {activeTopic?.name} <span className="crumb-sep">›</span> {title}
            </span>
            {status && <span className="status-inline">{status}</span>}
            <span className="spacer" />
            <div className="zoom">
              <button className="btn" disabled={!stats?.canZoomOut} onClick={() => viewRef.current?.zoomOut()}>
                −
              </button>
              <span className="page">{pageText}</span>
              <button className="btn" disabled={!stats?.canZoomIn} onClick={() => viewRef.current?.zoomIn()}>
                +
              </button>
            </div>
          </>
        ) : (
          <>
            {activeTopic ? (
              <button className="btn" onClick={() => setActiveTopicId(null)}>
                ‹ Topics
              </button>
            ) : (
              <span className="title">Reading Partner</span>
            )}
            {activeTopic && <span className="crumb">{activeTopic.name}</span>}
            <span className="spacer" />
          </>
        )}
      </header>

      <main className={`body${inReader && sidebarOpen ? " sidebar-open" : ""}`}>
        {/* Trace panel sits on the LEFT (Zotero iPad Annotations position);
            the right side is reserved for the future AI column. */}
        {inReader && sidebarOpen && (
          <aside className="trace-sidebar">
            <TraceList
              annotations={traceAnns as unknown as PopupAnnotation[]}
              selectedId={selectedAnnId}
              onSelect={onTraceSelect}
              onToggleStar={(id, starred) => patchAnnotation(id, { starred })}
              onOpenThread={openThreadForAnnotation}
            />
          </aside>
        )}

        <iframe ref={iframeRef} className="reader" src={HOST_SRC} title="reader" />

        {inReader && (
          <div className="pen-rail">
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
          <div className="overlay">
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
            onClose={bubbleToPip}
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
    <div className="library">
      <h1 className="library-title">Topics</h1>
      <div className="topic-new">
        <input
          className="input"
          placeholder="New topic (e.g. what makes JITs fast)"
          value={props.newTopicName}
          onChange={(e) => props.setNewTopicName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && props.onCreate()}
        />
        <button className="btn" onClick={props.onCreate}>
          Add
        </button>
      </div>
      {props.topics.length === 0 && <p className="muted">No topics yet. Create one to start reading.</p>}
      <ul className="topic-list">
        {props.topics.map((t) => (
          <li key={t.id} className="topic-row">
            {props.renamingId === t.id ? (
              <input
                className="input"
                autoFocus
                value={props.renameText}
                onChange={(e) => props.setRenameText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && props.onCommitRename()}
                onBlur={props.onCommitRename}
              />
            ) : (
              <button className="topic-name" onClick={() => props.onOpen(t)}>
                {t.name}
                <span className="topic-count">{t.files.length} file{t.files.length === 1 ? "" : "s"}</span>
              </button>
            )}
            <div className="topic-actions">
              <button className="btn small" onClick={() => props.onStartRename(t)}>
                Rename
              </button>
              <button className="btn small danger" onClick={() => props.onDelete(t)}>
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
    <div className="library">
      <div className="topic-head">
        <h1 className="library-title">{props.topic.name}</h1>
        <button className="btn" onClick={props.onAddFile}>
          Add PDF
        </button>
      </div>
      {files.length === 0 && <p className="muted">No files yet. Add a PDF to this topic.</p>}
      <ul className="topic-list">
        {files.map((f) => (
          <li key={f.path} className="topic-row">
            <button className="topic-name" onClick={() => props.onOpenFile(f.path, f.name)}>
              {f.name}
            </button>
            <div className="topic-actions">
              <button className="btn small danger" onClick={() => props.onRemoveFile(f.path)}>
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
