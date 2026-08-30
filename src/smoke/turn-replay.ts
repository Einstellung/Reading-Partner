// The consistency check between the two turn detectors: the one in
// src/info/companion/turn-detect.ts, which the 29 tests are written against, and
// the transliteration in plugins/voice/ios/Sources/VoiceTurn.swift, which is
// what actually decides who is talking on the phone.
//
// One command per case. The levels are the ones the earlier probe recorded on
// this device (src/info/companion/turn-replay.ts holds them), the device runs
// them through the ported machine, and the event streams are compared position
// by position. Nobody has to be in front of the phone, nothing plays, nothing
// listens: it is arithmetic on both sides, so it can run on every build.
//
// Where the answers differ, the difference is the finding, and it is in the
// file: which case, which position, what each side said.

import { invoke } from "@tauri-apps/api/core";
import { mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "../platform/app/atomic-fs";
import {
  resolveTurnDetectConfig,
  type TurnDetectConfig,
} from "../info/companion/turn-detect";
import {
  diffReplay,
  turnReplayCases,
  type ReplayCase,
  type ReplayEvent,
} from "../info/companion/turn-replay";

export const TURN_REPLAY_DIR = "turn";
export const TURN_REPLAY_FILE = "turn/turn-replay.json";

/// What Swift answers: TurnReplayReport, verbatim. The config fields are what
/// the device's own initialiser clamped the patch to, so a clamp that drifted
/// shows up without a second command.
interface DeviceReport {
  label: string;
  frames: number;
  startDb: number;
  startFrames: number;
  confirmMs: number;
  resumeMs: number;
  hangoverMs: number;
  resumeGuardMs: number;
  events: ReplayEvent[];
}

interface CaseResult {
  name: string;
  ok: boolean;
  config: Partial<TurnDetectConfig>;
  frames: number;
  expected: ReplayEvent[];
  /// Null when the command itself failed.
  got: ReplayEvent[] | null;
  /// Empty when the two streams agree. Every line is one position.
  differences: string[];
  error: string | null;
}

interface ReplayResult {
  ok: boolean;
  cases: CaseResult[];
  failed: number;
  error: string | null;
  timestamp: string;
}

async function write(result: ReplayResult): Promise<void> {
  try {
    await mkdir(TURN_REPLAY_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
    await writeTextAtomic(TURN_REPLAY_FILE, JSON.stringify(result, null, 2));
  } catch (e) {
    console.error("writing the replay result failed", e);
  }
}

/// A line on the device console from the webview, the way turn-probe.ts does it:
/// `console.log` in a WKWebView reaches nothing a cable can read.
async function note(text: string): Promise<void> {
  try {
    await invoke("plugin:voice|speech_probe", {
      args: { label: text, source: "trimmed", pace: "burst", fixtureDir: "", mode: "note" },
    });
  } catch {
    /* the run matters, the breadcrumb does not */
  }
}

/// One case through the device. The frames go over as they are: -Infinity has no
/// JSON spelling and crosses as null, which is what the Swift side reads back as
/// digital silence, and a `reset` frame is a call rather than a buffer.
async function replay(item: ReplayCase): Promise<DeviceReport> {
  return (await invoke("plugin:voice|speech_probe", {
    args: {
      label: item.name,
      source: "trimmed",
      pace: "burst",
      fixtureDir: "",
      mode: "turn-replay",
      frames: item.frames,
      turnConfig: item.config,
    },
  })) as DeviceReport;
}

/// The config the device says it ran with, against the one resolving the same
/// patch produces here. A defaults table that drifted would otherwise show up as
/// a pile of event differences with no cause attached.
function configDiff(item: ReplayCase, report: DeviceReport): string[] {
  const want = resolveTurnDetectConfig(item.config);
  const lines: string[] = [];
  const check = (key: keyof TurnDetectConfig) => {
    if (report[key] !== want[key]) lines.push(`config ${key} ${report[key]}, expected ${want[key]}`);
  };
  check("startDb");
  check("startFrames");
  check("confirmMs");
  check("resumeMs");
  check("hangoverMs");
  check("resumeGuardMs");
  if (report.frames !== item.frames.length) {
    lines.push(`frames ${report.frames}, expected ${item.frames.length}`);
  }
  return lines;
}

function paint(head: string, lines: string[], ok: boolean): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = "";
  const box = document.createElement("div");
  box.style.cssText =
    "font:14px/1.5 ui-monospace,Menlo,monospace;padding:20px;min-height:100vh;" +
    `background:${ok ? "#0a7d28" : "#7d1a0a"};color:#fff;box-sizing:border-box;` +
    "display:flex;flex-direction:column;gap:12px";
  const title = document.createElement("div");
  title.style.cssText = "font-size:24px;font-weight:800";
  title.textContent = head;
  const body = document.createElement("div");
  body.style.cssText = "white-space:pre-wrap;font-size:13px;opacity:.92";
  body.textContent = lines.join("\n");
  box.append(title, body);
  root.appendChild(box);
}

export async function runTurnReplay(): Promise<void> {
  const cases = turnReplayCases();
  const result: ReplayResult = {
    ok: false,
    cases: [],
    failed: 0,
    error: null,
    timestamp: new Date().toISOString(),
  };
  paint("REPLAY", [`${cases.length} cases`], true);
  await note(`turn replay: ${cases.length} cases`);

  try {
    for (const item of cases) {
      const line: CaseResult = {
        name: item.name,
        ok: false,
        config: item.config,
        frames: item.frames.length,
        expected: item.expected,
        got: null,
        differences: [],
        error: null,
      };
      try {
        const report = await replay(item);
        line.got = report.events ?? [];
        line.differences = [...configDiff(item, report), ...diffReplay(item.expected, line.got)];
        line.ok = line.differences.length === 0;
      } catch (e) {
        line.error = String(e);
      }
      result.cases.push(line);
      if (!line.ok) result.failed += 1;
      await note(
        `${line.name}: ${line.ok ? "same" : line.error ?? line.differences.join("; ")}`,
      );
      paint(
        `REPLAY ${result.cases.length}/${cases.length}`,
        result.cases.map((c) => `${c.ok ? "ok  " : "FAIL"} ${c.name}`),
        result.failed === 0,
      );
    }
    result.ok = result.failed === 0;
  } catch (e) {
    result.error = String(e);
  }

  await write(result);
  const detail = result.cases
    .filter((c) => !c.ok)
    .flatMap((c) => [c.name, ...(c.error ? [c.error] : c.differences)].map((l) => `  ${l}`));
  paint(
    result.ok ? `SAME on all ${cases.length}` : `${result.failed} of ${cases.length} DIFFER`,
    [...result.cases.map((c) => `${c.ok ? "ok  " : "FAIL"} ${c.name}`), "", ...detail],
    result.ok,
  );
  await note(`turn replay done: ${result.failed} differ`);
}
