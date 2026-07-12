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
import PenToolbar from "./components/PenToolbar";
import AnnotationPopup from "./components/AnnotationPopup";
import TraceList from "./components/TraceList";
import type { Annotation as PopupAnnotation, ToolType } from "./components/types";

const HOST_SRC = "/reader/reader-host.html";

interface PopupState {
  annotation: Annotation;
  anchor: { x: number; y: number };
}

export default function App() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const viewRef = useRef<ViewInstance | null>(null);
  const pathRef = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const lastState = useRef<ViewState | null>(null);

  // Annotations for the open document, keyed by id for merge-on-save.
  const annsRef = useRef<Map<string, Annotation>>(new Map());

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
  }, [refreshTopics]);

  // Apply the tool once the view is initialized (setTool before the pdf viewer
  // is ready throws — PDFViewerApplication null, pitfall 11).
  useEffect(() => {
    if (!viewReady) return;
    const tool =
      toolType === "pointer" ? { type: "pointer" as const } : { type: toolType, color: penColor };
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
  const onSaveAnnotations = useCallback(
    (incoming: Annotation[]) => {
      for (const a of incoming) {
        const { onlyTextOrComment, ...clean } = a as Annotation & { onlyTextOrComment?: boolean };
        void onlyTextOrComment;
        const prev = annsRef.current.get(clean.id);
        annsRef.current.set(clean.id, prev ? { ...prev, ...clean } : clean);
      }
      persistAnnotations();
      syncTraceList();
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

  // Popup anchor is in the shell's viewport; the engine rect is iframe-local,
  // so add the iframe's offset.
  const onSetAnnotationPopup = useCallback((params?: AnnotationPopupParams) => {
    if (!params) {
      setPopup(null);
      return;
    }
    const rect = iframeRef.current?.getBoundingClientRect();
    const dx = rect?.left ?? 0;
    const dy = rect?.top ?? 0;
    const [l, , r, bottom] = params.rect;
    setPopup({ annotation: params.annotation, anchor: { x: dx + (l + r) / 2, y: dy + bottom } });
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

  const openInReader = useCallback(
    async (path: string, name: string, bytes: Uint8Array) => {
      setStatus("Rendering…");
      setPopup(null);
      setSelectedAnnId(null);
      const state = await getViewState(path);
      let saved: Annotation[] = [];
      try {
        saved = await loadAnnotations(path);
      } catch (e) {
        console.error("failed to load annotations", e);
        setStatus("Warning: saved annotations could not be loaded");
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
        },
      });
      viewRef.current = view;
      setTitle(name);
    },
    [reloadFrame, persist, onSaveAnnotations, onDeleteAnnotations, onSetAnnotationPopup],
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
      </main>
    </div>
  );
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
