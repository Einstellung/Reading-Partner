// On-device Kokoro TTS (plugins/voice/src/kokoro, docs/companion/136): the
// weights download and the device bench. Kokoro is the only voice, on iOS only
// (plugins/voice/src/session.rs `on_device_voice`): until the fp32 files are
// downloaded and verified a turn is refused with a message pointing at
// Settings. Desktop and Android read nothing aloud. The network vendor, Xiaomi
// MiMo, was removed on 2026-10-18.
//
// The plugin downloads in the background and answers every question from the
// files on disk, so the webview polls `kokoroStatus` rather than listening for
// progress events.

// The commands, checked by a test against plugins/voice/build.rs: a typo is
// silent until a device build rejects the invoke.
export const KOKORO_COMMANDS = {
  status: "plugin:voice|kokoro_status",
  download: "plugin:voice|kokoro_download",
  bench: "plugin:voice|kokoro_bench",
} as const;

export type KokoroVariant = "fp32" | "fp16" | "int8";

// The variant that speaks (plugins/voice/src/tts/kokoro.rs VARIANT): fp16 gives
// NaN on iOS and int8 is out.
export const KOKORO_SPEAKING_VARIANT: KokoroVariant = "fp32";

export interface KokoroFileStatus {
  path: string;
  size: number;
  have: number;
  ready: boolean;
}

// plugins/voice/src/kokoro/download.rs ModelStatus, camelCased.
export interface KokoroStatus {
  repo: string;
  revision: string;
  root: string;
  running: boolean;
  current: string | null;
  error: string | null;
  ready: KokoroVariant[];
  requested: KokoroVariant[];
  haveBytes: number;
  totalBytes: number;
  files: KokoroFileStatus[];
}

export interface KokoroBenchArgs {
  phonemes: string[];
  voice?: string;
  variants?: KokoroVariant[];
  threads?: number[];
  speed?: number;
  reps?: number;
}

// The one invoke, as a parameter so all of this runs under bun.
export interface KokoroBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

export function kokoroStatus(bridge: KokoroBridge): Promise<KokoroStatus> {
  return bridge.invoke<KokoroStatus>(KOKORO_COMMANDS.status);
}

export function startKokoroDownload(
  bridge: KokoroBridge,
  variants: KokoroVariant[],
): Promise<KokoroStatus> {
  return bridge.invoke<KokoroStatus>(KOKORO_COMMANDS.download, { variants });
}

// Debug builds only; resolves with the plugin's BenchReport after minutes.
export function runKokoroBench(bridge: KokoroBridge, args: KokoroBenchArgs): Promise<unknown> {
  return bridge.invoke(KOKORO_COMMANDS.bench, { args });
}

export type KokoroDownloadState =
  | { kind: "idle" }
  | { kind: "downloading"; fraction: number; current: string | null }
  | { kind: "failed"; error: string; fraction: number }
  | { kind: "ready" };

// What a settings row would say about the requested variant. `fraction` is
// over the requested files only; a resumed download starts above zero.
export function downloadState(s: KokoroStatus, variant: KokoroVariant): KokoroDownloadState {
  if (s.ready.includes(variant)) return { kind: "ready" };
  const fraction = s.totalBytes > 0 ? Math.min(1, s.haveBytes / s.totalBytes) : 0;
  if (s.running) return { kind: "downloading", fraction, current: s.current };
  if (s.error) return { kind: "failed", error: s.error, fraction };
  return { kind: "idle" };
}

// What speaks on iOS: Kokoro once the variant is fully downloaded and verified,
// nothing before that (there is no fallback), and nothing when the
// status cannot be read.
export function speakingEngine(
  s: KokoroStatus | null,
  variant: KokoroVariant = KOKORO_SPEAKING_VARIANT,
): "kokoro" | "none" {
  return s?.ready.includes(variant) ? "kokoro" : "none";
}
