// The debug binary as a browse host (src-tauri/src/webview_fetch/browse.rs in
// stdin-plan mode, RP_WEBVIEW_BROWSE_PROBE=-), for the dev drivers that read X
// in bun: scripts/x-reader-live.ts and scripts/topic-search-live.ts.
//
// Isolation: XDG data, config and cache dirs under PROFILE (default
// ~/.cache/reading-partner-x-probe, which holds the probe's own X sign-in), its
// own session bus, and Xvfb with a screen of the given size. Never the app's
// data directory or cookie jar, never a window on the desktop.

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowseHost } from "../src/workshop/extract/webview-browse";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BIN = join(ROOT, "src-tauri/target/debug/reading-partner");
export const PROFILE = process.env.RP_X_PROBE_PROFILE ?? join(homedir(), ".cache/reading-partner-x-probe");

interface Line {
	step: number;
	op: string;
	result: Record<string, unknown>;
}

/** The debug binary in stdin-plan mode, answering the facade's host calls. */
export class PipeHost implements BrowseHost {
	private child: ReturnType<typeof Bun.spawn> | null = null;
	private waiting: ((line: Line) => void)[] = [];
	private log: string;

	constructor(
		private screen: { width: number; height: number },
		tag: string,
	) {
		const runs = join(PROFILE, "runs");
		mkdirSync(runs, { recursive: true });
		this.log = join(runs, `${new Date().toISOString().replace(/[:.]/g, "-")}-${tag}.browse.log`);
	}

	available(): boolean {
		return true;
	}

	pid(): number | null {
		return this.child?.pid ?? null;
	}

	private start(): void {
		if (!existsSync(BIN)) throw new Error(`no binary at ${BIN}`);
		const dirs = { data: join(PROFILE, "data"), config: join(PROFILE, "config"), cache: join(PROFILE, "cache") };
		for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
		const xvfb = `-screen 0 ${this.screen.width}x${this.screen.height}x24`;
		this.child = Bun.spawn(["dbus-run-session", "--", "xvfb-run", "-a", "-s", xvfb, BIN], {
			env: {
				...process.env,
				XDG_DATA_HOME: dirs.data,
				XDG_CONFIG_HOME: dirs.config,
				XDG_CACHE_HOME: dirs.cache,
				GTK_USE_PORTAL: "0",
				NO_AT_BRIDGE: "1",
				RP_WEBVIEW_BROWSE_PROBE: "-",
			},
			stdin: "pipe",
			stdout: "pipe",
			stderr: "ignore",
		});
		console.error(`binary pid ${this.child.pid}; log ${this.log}`);
		void this.pump();
	}

	private async pump(): Promise<void> {
		const out = this.child!.stdout as ReadableStream<Uint8Array>;
		const reader = out.getReader();
		const decoder = new TextDecoder();
		let buf = "";
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buf += decoder.decode(value);
			let nl: number;
			while ((nl = buf.indexOf("\n")) >= 0) {
				const text = buf.slice(0, nl);
				buf = buf.slice(nl + 1);
				if (!text.startsWith("RP-BROWSE ")) continue;
				const line = JSON.parse(text.slice("RP-BROWSE ".length)) as Line;
				appendFileSync(this.log, JSON.stringify({ ...line, result: shorten(line.result) }) + "\n");
				const next = this.waiting.shift();
				if (next) next(line);
			}
		}
		for (const w of this.waiting.splice(0)) w({ step: -1, op: "exit", result: {} });
	}

	private send(obj: unknown): Promise<Line> {
		const stdin = this.child!.stdin as import("bun").FileSink;
		const answer = new Promise<Line>((res) => this.waiting.push(res));
		stdin.write(JSON.stringify(obj) + "\n");
		stdin.flush();
		return answer;
	}

	async invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
		if (cmd === "browse_open") {
			this.start();
			const line = await this.send({ idleTimeoutMs: args.idleTimeoutMs ?? 3_600_000, viewport: args.viewport, initScript: args.initScript ?? null });
			return line.result as T;
		}
		if (cmd === "browse_close") {
			const stdin = this.child!.stdin as import("bun").FileSink;
			const answer = new Promise<Line>((res) => this.waiting.push(res));
			stdin.end();
			const line = await answer;
			await this.child!.exited;
			return Boolean(line.result.closed) as T;
		}
		const step =
			cmd === "browse_navigate"
				? { op: "navigate", url: args.url, until: args.until, timeoutMs: args.timeoutMs }
				: cmd === "browse_back"
					? { op: "back", until: args.until, timeoutMs: args.timeoutMs }
					: cmd === "browse_eval"
						? { op: "eval", script: args.script }
						: cmd === "browse_scroll"
							? { op: "scroll", dy: args.dy }
							: null;
		if (!step) throw new Error(`unknown host call ${cmd}`);
		const line = await this.send(step);
		if (line.op === "exit") return { status: "closed", detail: "binary exited" } as T;
		if (line.op === "error") throw new Error(String(line.result.error));
		return line.result as T;
	}
}

function shorten(value: unknown): unknown {
	const s = JSON.stringify(value);
	if (s === undefined) return value;
	return s.length > 4000 ? `${s.slice(0, 4000)}…` : value;
}
