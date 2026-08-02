import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

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
  // Matches the `paths` entry in tsconfig.json; the shadcn CLI writes `@/`
  // imports into every component it generates.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 1420,
    strictPort: true,
    headers: isolationHeaders,
    watch: {
      // src-tauri is the Rust side; .claude holds agent worktrees whose file
      // churn must not trigger reloads in the user's dev session.
      ignored: ["**/src-tauri/**", "**/.claude/**", "**/.playwright-mcp/**"],
    },
  },
  preview: { port: 1421, strictPort: true, headers: isolationHeaders },
  // The engine test harness (embedpdf-spike.html) is dev-only: Vite serves it
  // on demand, but it is not built into the production bundle.
});
