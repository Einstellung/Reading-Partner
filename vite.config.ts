import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// EmbedPDF's PDFium wasm needs SharedArrayBuffer, granted only to a
// cross-origin-isolated page. Apply COOP/COEP only when the EmbedPDF engine is
// selected so the default zotero path is untouched.
const embedpdf = process.env.VITE_ENGINE === "embedpdf";
const isolationHeaders = embedpdf
  ? {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    }
  : {};

// Tauri expects a fixed port and no clearing of the terminal.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  // Only scan the app entry; vendor/ holds the reader's own pdf.js sources
  // whose bare imports must not be pulled into the shell's dep graph.
  optimizeDeps: { entries: ["index.html"] },
  server: {
    port: 1420,
    strictPort: true,
    headers: isolationHeaders,
    watch: {
      // src-tauri is the Rust side; Vite shouldn't watch it.
      ignored: ["**/src-tauri/**"],
    },
  },
});
