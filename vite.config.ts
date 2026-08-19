import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { simBridge } from "./scripts/sim-bridge";

// Cross-origin isolation, kept but not for the reason it was added. The wasm was
// believed to be a pthread build needing SharedArrayBuffer; it is not, and the
// reader runs with crossOriginIsolated false in the packaged app (pitfall 18).
// Production gets the same headers from tauri.conf.json (app.security.headers).
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

// Tauri expects a fixed port and no clearing of the terminal.
export default defineConfig({
  // simBridge is dev-only (apply: "serve") and loopback-only: it injects the
  // eval channel the iOS simulator loop drives the webview through
  // (scripts/ios-sim.sh), and installs nothing once `server.host` puts this
  // server on an address other machines can reach.
  plugins: [react(), tailwindcss(), simBridge()],
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
    // Transform the entry graph while the Rust side is still compiling, instead
    // of on the first page load. Dev serves ~410 separate modules and Vite
    // transforms each one on demand, so a cold server spends that work under a
    // blank window: measured in the Tauri webview, first contentful paint drops
    // from 1306ms to 408ms with these three warmed. `beforeDevCommand` starts
    // Vite a full cargo build before the window opens, so the warm-up is free.
    // Both shells are listed because main.tsx picks between them at runtime.
    warmup: { clientFiles: ["./src/main.tsx", "./src/App.tsx", "./src/PhoneApp.tsx"] },
    watch: {
      // src-tauri is the Rust side; .claude holds agent worktrees whose file
      // churn must not trigger reloads in the user's dev session.
      ignored: ["**/src-tauri/**", "**/.claude/**", "**/.playwright-mcp/**"],
    },
  },
  preview: { port: 1421, strictPort: true, headers: isolationHeaders },
  // The test harnesses (embedpdf-spike.html for the engine, chat-aside-spike.html
  // for the chat's aside control) are dev-only: Vite serves them on demand, but
  // only index.html is an entry, so neither is built into the production bundle.
});
