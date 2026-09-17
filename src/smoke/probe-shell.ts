// What every probe in this directory needs around the thing it is actually
// measuring: write the verdict somewhere the host can fetch it, say something
// the device console can carry, put something on the screen, and press the
// shipped UI with a pointer that does not exist.
//
// Nothing here measures anything. A probe keeps its own sequencing, its own
// result shape and its own file name — the host scripts read those — and takes
// only the parts that were character-for-character the same in every copy.

import { invoke } from "@tauri-apps/api/core";
import { mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "../platform/app/atomic-fs";

/// Every probe waits on the clock somewhere.
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/// The verdict file: pretty-printed JSON under AppData, written atomically so a
/// host fetching it mid-run never reads half a file. `onError` is the caller's
/// because a failed write means something different to each probe — a run that
/// is twenty minutes long does not stop for it, and the one whose only output
/// is a screenshot has to put the reason on the screen.
export async function writeProbeResult(
  dir: string,
  file: string,
  result: unknown,
  onError: (e: unknown) => void,
): Promise<void> {
  try {
    await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true });
    await writeTextAtomic(file, JSON.stringify(result, null, 2));
  } catch (e) {
    onError(e);
  }
}

/// A line on the device console from the webview. `console.log` in a WKWebView
/// reaches nothing a cable can read, so it goes out through the plugin and
/// `idevicesyslog -p 'Reading Partner'` picks it up. The arguments besides
/// `label` are only there because the probe's argument type requires them.
/// Never throws: a broken breadcrumb must not end a run.
export async function note(text: string): Promise<void> {
  try {
    await invoke("plugin:voice|speech_probe", {
      args: { label: text, source: "trimmed", pace: "burst", fixtureDir: "", mode: "note" },
    });
  } catch {
    /* the run matters, the breadcrumb does not */
  }
}

/// The whole result on the screen, so a photograph of the phone carries the
/// same answer as the file. `done` is what the heading says once it is over.
export function renderReport(result: { ok: boolean; stage: string }, done: string): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = "";
  const box = document.createElement("div");
  box.style.cssText =
    "font:13px/1.5 -apple-system,system-ui,sans-serif;padding:14px;color:#111;background:#fff;min-height:100vh";
  const head = document.createElement("div");
  head.style.cssText = `font-size:20px;font-weight:700;margin-bottom:10px;color:${
    result.ok ? "#0a7d28" : "#c00"
  }`;
  head.textContent = result.ok ? done : `RUNNING — ${result.stage}`;
  box.appendChild(head);
  const pre = document.createElement("pre");
  pre.style.cssText = "white-space:pre-wrap;font-size:11px;margin:0";
  pre.textContent = JSON.stringify(result, null, 2);
  box.appendChild(pre);
  root.appendChild(box);
}

/// The only channel a probe with a person in front of it has: a heading, the
/// sentence they are to read, and a line under it saying what happens next.
/// Green once it is their turn. Repainted on every tick — a dozen repaints
/// costs nothing and there is no state to keep.
export function paintPrompt(
  head: string,
  line: string,
  hint: string,
  go: boolean,
  size: { sentencePx: number; footPx: number },
): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = "";
  const box = document.createElement("div");
  box.style.cssText =
    "font:15px/1.6 -apple-system,system-ui,sans-serif;padding:24px;min-height:100vh;" +
    `background:${go ? "#0a7d28" : "#101418"};color:#fff;box-sizing:border-box;` +
    "display:flex;flex-direction:column;justify-content:center;gap:20px";
  const title = document.createElement("div");
  title.style.cssText = "font-size:28px;font-weight:800;letter-spacing:.5px";
  title.textContent = head;
  const sentence = document.createElement("div");
  sentence.style.cssText =
    `font-size:${size.sentencePx}px;font-weight:600;line-height:1.5;padding:16px;border-radius:12px;` +
    "background:rgba(255,255,255,.14)";
  sentence.textContent = line;
  const foot = document.createElement("div");
  foot.style.cssText = `font-size:${size.footPx}px;opacity:.85`;
  foot.textContent = hint;
  box.append(title, sentence, foot);
  root.appendChild(box);
}

/// A synthesised pointer id is not a live pointer, so setPointerCapture throws
/// NotFoundError and would abort the handler before it dispatched `down`. The
/// two capture calls are the only thing stubbed; everything the pressed
/// component does after them is the shipped path.
export function stubPointerCapture(): void {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.setPointerCapture = function () {};
  proto.releasePointerCapture = function () {};
}

/// One pointer event on a real component, as a finger would deliver it.
export function pointer(el: Element, type: string, x: number, y: number): void {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: x,
      clientY: y,
      buttons: type === "pointerup" ? 0 : 1,
    }),
  );
}
