// The dev server's side of the silent voice bench (docs/platform/560):
//
//   POST /__voice-harness/run?script=<name>  → sends `voice-harness:run` to the
//        app over the HMR socket and answers {"id"}.
//   POST /__voice-harness/cancel?id=<id>    → tells the app to end that run.
//   POST /__voice-harness/status?id=<id>     ← the app's progress (JSON body).
//   GET  /__voice-harness/status?id=<id>     → the latest progress, or null.
//
// The app listens in src/smoke/voice-harness.ts; voice-run.sh drives the two
// ends from the shell.
import type { Plugin } from "vite";

export function voiceHarness(): Plugin {
  const status = new Map<string, unknown>();
  let seq = 0;
  return {
    name: "rp-voice-harness",
    configureServer(server) {
      server.middlewares.use("/__voice-harness", (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://dev");
        const reply = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(body));
        };
        if (req.method === "POST" && url.pathname === "/run") {
          const script = url.searchParams.get("script");
          if (!script || !/^[\w.-]+$/.test(script)) return reply(400, { error: "script=<name>" });
          const id = `${Date.now()}-${++seq}`;
          const timeoutSec = Number(url.searchParams.get("timeout")) || undefined;
          status.set(id, { state: "sent", script });
          server.ws.send({ type: "custom", event: "voice-harness:run", data: { script, id, timeoutSec } });
          return reply(200, { id });
        }
        if (req.method === "POST" && url.pathname === "/cancel") {
          const id = url.searchParams.get("id") ?? "";
          server.ws.send({ type: "custom", event: "voice-harness:cancel", data: { id } });
          return reply(200, { ok: true });
        }
        if (url.pathname === "/status") {
          const id = url.searchParams.get("id") ?? "";
          if (req.method === "POST") {
            let body = "";
            req.on("data", (c: Buffer) => (body += c.toString()));
            req.on("end", () => {
              try {
                status.set(id, JSON.parse(body));
              } catch {
                status.set(id, { state: "unreadable", body });
              }
              reply(200, { ok: true });
            });
            return;
          }
          return reply(200, status.get(id) ?? null);
        }
        next();
      });
    },
  };
}
