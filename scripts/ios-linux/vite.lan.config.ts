// Vite for the .dev build on a physical device, served from this Linux box.
// The app's devUrl is baked in at build time (ios-linux-loop.yml), so host and
// port here must match DEV_HOST / DEV_PORT there. Port 1437 rather than 1420 so
// it can run next to the user's own `tauri dev`.
//
// Three overrides of the main config, each for a measured reason:
//  - watch.ignored drops `**/.claude/**`: from an agent worktree that pattern
//    excludes the whole tree and edits never reload (pitfall 403).
//  - cacheDir moves out of node_modules: in a worktree node_modules is a link to
//    the main checkout's, and Vite's prebundle cache would be written into the
//    user's tree (pitfall 142).
//  - the HMR socket gets its own port next to the page's.
//
// Anyone on the LAN can read what this server serves, node_modules included
// (pitfall 123). Run it only on a network you trust and stop it when done.
import type { UserConfig } from "vite";
import base from "../../vite.config";
import os from "node:os";
import path from "node:path";

const host = process.env.RP_LAN_HOST || "10.42.0.1";
const port = Number(process.env.RP_DEV_PORT || 1437);
const cfg = base as UserConfig;

export default {
  ...cfg,
  cacheDir: path.join(os.homedir(), ".cache", "rp-vite-lan"),
  server: {
    ...cfg.server,
    host,
    port,
    strictPort: true,
    hmr: { protocol: "ws", host, port: port + 1 },
    warmup: undefined,
    watch: { ignored: ["**/src-tauri/**", "**/.playwright-mcp/**"] },
  },
} satisfies UserConfig;
