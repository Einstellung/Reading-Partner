import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  getEntry,
  getRecents,
  upsertEntry,
  type FileEntry,
} from "./storage";
import {
  ANNOTATION_COLORS,
  deleteAnnotations,
  loadAnnotations,
  onSaveError,
  saveAnnotations,
} from "./annotations";
import PenToolbar from "./components/PenToolbar";
import AnnotationPopup from "./components/AnnotationPopup";
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

  // Annotations for the open document, keyed by id for merge-on-save.
  const annsRef = useRef<Map<string, Annotation>>(new Map());

  const [recents, setRecents] = useState<FileEntry[]>([]);
  const [stats, setStats] = useState<ViewStats | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [status, setStatus] = useState("Open a PDF to start reading");
  const [toolType, setToolType] = useState<ToolType>("pointer");
  const [penColor, setPenColor] = useState(ANNOTATION_COLORS[0].color);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [viewReady, setViewReady] = useState(false);

  useEffect(() => {
    getRecents().then(setRecents).catch(() => {});
    onSaveError((e) => {
      console.error("failed to persist annotations", e);
      setStatus("Warning: annotations could not be saved");
    });
  }, []);

  // Apply the tool to the engine — but only once the view is initialized;
  // setTool before the pdf viewer is ready throws (PDFViewerApplication null).
  // Runs on tool change and when a freshly opened view becomes ready.
  useEffect(() => {
    if (!viewReady) return;
    const tool =
      toolType === "pointer" ? { type: "pointer" as const } : { type: toolType, color: penColor };
    viewRef.current?.setTool(tool);
  }, [toolType, penColor, viewReady]);

  // Debounced persist of the reading position, keyed by file path.
  // A save failure must be visible: silently losing positions looks like
  // the feature works until the app is reopened.
  const lastState = useRef<ViewState | null>(null);
  const persist = useCallback((state: ViewState) => {
    const path = pathRef.current;
    if (!path) return;
    lastState.current = state;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      upsertEntry(path, state)
        .then(getRecents)
        .then(setRecents)
        .catch((e) => {
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
      void upsertEntry(path, lastState.current).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
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
    },
    [persistAnnotations],
  );

  const onDeleteAnnotations = useCallback(
    (ids: string[]) => {
      for (const id of ids) annsRef.current.delete(id);
      const path = pathRef.current;
      if (path) deleteAnnotations(path, ids);
    },
    [],
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
    setPopup({
      annotation: params.annotation,
      anchor: { x: dx + (l + r) / 2, y: dy + bottom },
    });
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
    async (path: string, bytes: Uint8Array) => {
      setStatus("Rendering…");
      setPopup(null);
      const entry = await getEntry(path);
      let saved: Annotation[] = [];
      try {
        saved = await loadAnnotations(path);
      } catch (e) {
        console.error("failed to load annotations", e);
        setStatus("Warning: saved annotations could not be loaded");
      }
      annsRef.current = new Map(saved.map((a) => [a.id, a]));

      setViewReady(false);
      const iframe = await reloadFrame();
      pathRef.current = path;
      const view = await createPdfView(iframe, bytes.buffer as ArrayBuffer, {
        type: "pdf",
        annotations: saved,
        authorName: "Reading-Partner",
        viewState: entry?.viewState ?? null,
        onChangeViewState: persist,
        onChangeViewStats: setStats,
        onSaveAnnotations,
        onDeleteAnnotations,
        // The engine opens the annotation popup only after the selection is fed
        // back; without this, clicking a highlight never shows the popup.
        onSelectAnnotations: (ids) => viewRef.current?.selectAnnotations(ids),
        onSetAnnotationPopup,
        // The active tool is applied once ready (setTool before init throws).
        onInitialized: () => {
          setStatus("");
          setViewReady(true);
        },
      });
      viewRef.current = view;
      setTitle(path.split(/[/\\]/).pop() || path);
      await upsertEntry(path, entry?.viewState ?? null);
      setRecents(await getRecents());
    },
    [reloadFrame, persist, onSaveAnnotations, onDeleteAnnotations, onSetAnnotationPopup],
  );

  const openViaDialog = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (typeof selected !== "string") return;
    const bytes = await readFile(selected);
    await openInReader(selected, bytes);
  }, [openInReader]);

  const openPath = useCallback(
    async (path: string) => {
      try {
        const bytes = await readFile(path);
        await openInReader(path, bytes);
      } catch {
        setStatus("Can't open this file — it may have been moved or deleted.");
      }
    },
    [openInReader],
  );

  // Host-side edit of an existing annotation: patch, re-render, persist.
  const patchAnnotation = useCallback(
    (id: string, patch: Partial<Annotation>) => {
      const prev = annsRef.current.get(id);
      if (!prev) return;
      const updated: Annotation = { ...prev, ...patch, dateModified: new Date().toISOString() };
      annsRef.current.set(id, updated);
      viewRef.current?.setAnnotations([updated]);
      persistAnnotations();
      setPopup((p) => (p && p.annotation.id === id ? { ...p, annotation: updated } : p));
    },
    [persistAnnotations],
  );

  const removeAnnotation = useCallback((id: string) => {
    viewRef.current?.unsetAnnotations([id]);
    annsRef.current.delete(id);
    const path = pathRef.current;
    if (path) deleteAnnotations(path, [id]);
    setPopup(null);
  }, []);

  const pageText = stats ? `${stats.pageIndex + 1} / ${stats.pagesCount}` : "— / —";

  return (
    <div className="app">
      <header className="toolbar">
        <button className="btn" onClick={openViaDialog}>
          Open File
        </button>
        <span className="title">{title ?? "Reading Partner"}</span>
        {title && status && <span className="status-inline">{status}</span>}
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
      </header>

      <main className="body">
        <iframe ref={iframeRef} className="reader" src={HOST_SRC} title="reader" />
        {title && (
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
        {!title && (
          <div className="overlay">
            <p className="status">{status}</p>
            {recents.length > 0 && (
              <div className="recents">
                <p className="recents-label">Recent</p>
                <ul>
                  {recents.map((r) => (
                    <li key={r.path}>
                      <button className="recent" onClick={() => openPath(r.path)}>
                        {r.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
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
