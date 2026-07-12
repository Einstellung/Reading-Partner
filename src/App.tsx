import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  createPdfView,
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

const HOST_SRC = "/reader/reader-host.html";

export default function App() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const viewRef = useRef<ViewInstance | null>(null);
  const pathRef = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  const [recents, setRecents] = useState<FileEntry[]>([]);
  const [stats, setStats] = useState<ViewStats | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [status, setStatus] = useState("Open a PDF to start reading");

  useEffect(() => {
    getRecents().then(setRecents).catch(() => {});
  }, []);

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

  // Best-effort flush of a pending (debounced) save when the window closes.
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

  // Reload the iframe fresh (resets any prior view) and resolve on load.
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
      const entry = await getEntry(path);
      const iframe = await reloadFrame();
      pathRef.current = path;
      viewRef.current = await createPdfView(iframe, bytes.buffer as ArrayBuffer, {
        type: "pdf",
        annotations: [],
        authorName: "Reading-Partner",
        viewState: entry?.viewState ?? null,
        onChangeViewState: persist,
        onChangeViewStats: setStats,
        onInitialized: () => setStatus(""),
      });
      const name = path.split(/[/\\]/).pop() || path;
      setTitle(name);
      await upsertEntry(path, entry?.viewState ?? null);
      setRecents(await getRecents());
    },
    [reloadFrame, persist],
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
          <button
            className="btn"
            disabled={!stats?.canZoomOut}
            onClick={() => viewRef.current?.zoomOut()}
          >
            −
          </button>
          <span className="page">{pageText}</span>
          <button
            className="btn"
            disabled={!stats?.canZoomIn}
            onClick={() => viewRef.current?.zoomIn()}
          >
            +
          </button>
        </div>
      </header>

      <main className="body">
        <iframe
          ref={iframeRef}
          className="reader"
          src={HOST_SRC}
          title="reader"
        />
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
      </main>
    </div>
  );
}
