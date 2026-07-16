// Engine selector for the spike. Default stays on the zotero/reader iframe;
// set VITE_ENGINE=embedpdf (env or .env.local) to mount the EmbedPDF adapter.
// The zotero path is untouched when this is false.
export const USE_EMBEDPDF =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_ENGINE ===
  "embedpdf";
