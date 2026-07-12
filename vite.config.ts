import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and no clearing of the terminal.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // Only scan the app entry; vendor/ holds the reader's own pdf.js sources
  // whose bare imports must not be pulled into the shell's dep graph.
  optimizeDeps: { entries: ["index.html"] },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // src-tauri is the Rust side; Vite shouldn't watch it.
      ignored: ["**/src-tauri/**"],
    },
  },
});
