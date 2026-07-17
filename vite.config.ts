import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The PDFium wasm is a pthread build: it needs SharedArrayBuffer, which the
// browser grants only to a cross-origin-isolated page (pitfall 18). Production
// gets the same headers from tauri.conf.json (app.security.headers).
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

// Tauri expects a fixed port and no clearing of the terminal.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    headers: isolationHeaders,
    watch: {
      // src-tauri is the Rust side; Vite shouldn't watch it.
      ignored: ["**/src-tauri/**"],
    },
  },
  preview: { port: 1421, strictPort: true, headers: isolationHeaders },
  // The engine test harness (embedpdf-spike.html) is dev-only: Vite serves it
  // on demand, but it is not built into the production bundle.
});
