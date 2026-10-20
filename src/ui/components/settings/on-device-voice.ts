// The "On-device voice" row of the Voice output section on iOS and of the Voice
// call section on Android: the Kokoro weights download, and on Android the
// listening models with it (ai/voice/kokoro.ts). What the row shows is a function of
// the plugin's status, and the plugin is polled rather than heard from, so the
// polling loop is here too, with its clock as a parameter.

import {
  kokoroStatus,
  startKokoroDownload,
  type KokoroBridge,
  type KokoroStatus,
  type KokoroVariant,
} from "../../../ai/voice/kokoro";
import { currentPlatform } from "../../../platform/app/platform";

// The one variant the app speaks with. Not the user's to pick.
export const VOICE_VARIANT: KokoroVariant = "fp32";

// plugins/voice-engine/kokoro-onnx/src/manifest.rs: the fp32 model plus the two voice
// files. Only for the hint before the first status read lands, or when it
// never does; every number on screen otherwise comes from the plugin.
export const FALLBACK_TOTAL_BYTES = 339_369_442 + 2 * 522_240;

// Android downloads the listening models too (docs/companion/89, "Model
// files"): Kokoro 340,413,922 + Qwen3-ASR 484,216,288 + its mmproj 214,392,480
// + Silero 2,327,524 + Smart Turn 32,411,198.
export const ANDROID_FALLBACK_TOTAL_BYTES = 1_073_761_412;

// Whether this host's voice is a call (listening and speaking) rather than
// speech alone.
export function isCallVoice(host: string = currentPlatform()): boolean {
  return host === "android";
}

export function fallbackTotalBytes(host: string = currentPlatform()): number {
  return isCallVoice(host) ? ANDROID_FALLBACK_TOTAL_BYTES : FALLBACK_TOTAL_BYTES;
}

// Whether every file the host needs is on disk and verified: the Kokoro
// variant, and where there is a listening package, that too. An absent
// `listenReady` is iOS (or an older plugin), which has no such package.
export function voiceReady(s: KokoroStatus | null, variant: KokoroVariant = VOICE_VARIANT): boolean {
  if (!s) return false;
  return s.ready.includes(variant) && (s.listenReady ?? true);
}

const VARIANT_FILE: Record<KokoroVariant, string> = {
  fp32: "onnx/model.onnx",
  fp16: "onnx/model_fp16.onnx",
  int8: "onnx/model_int8.onnx",
};

// Bytes on disk and in all for one variant, read off the per-file list rather
// than off haveBytes/totalBytes: those two count only what this process was
// asked to fetch, so after a relaunch they are zero even with half the model
// already on disk.
export function variantBytes(
  s: KokoroStatus,
  variant: KokoroVariant,
): { have: number; total: number } {
  let have = 0;
  let total = 0;
  for (const f of s.files) {
    if (f.path !== VARIANT_FILE[variant] && !f.path.startsWith("voices/")) continue;
    have += f.have;
    total += f.size;
  }
  for (const f of s.listen ?? []) {
    have += f.have;
    total += f.size;
  }
  if (total === 0) return { have: 0, total: fallbackTotalBytes() };
  return { have: Math.min(have, total), total };
}

export type VoiceRowView =
  | { kind: "idle"; totalMB: number; resumable: boolean; percent: number }
  | { kind: "starting"; totalMB: number }
  | { kind: "downloading"; percent: number; haveMB: number; totalMB: number }
  | { kind: "failed"; error: string; percent: number; haveMB: number; totalMB: number }
  | { kind: "ready" };

export function megabytes(bytes: number): number {
  return Math.round(bytes / 1_000_000);
}

// Floored, and held under 100 until the plugin says the variant is verified:
// the last file can be all on disk and still fail its checksum.
export function percentOf(have: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(99, Math.floor((have / total) * 100));
}

// What the row says. `status` is null until the first read succeeds (or when
// it never does: off iOS, or before the plugin is up), which reads as idle.
// `startError` is a failed invoke of the download command itself, which the
// plugin's status never learns about. `starting` is the moment between the
// press and the first status that shows the download running.
export function voiceRowView(
  status: KokoroStatus | null,
  opts: { startError?: string | null; starting?: boolean } = {},
): VoiceRowView {
  const bytes = status ? variantBytes(status, VOICE_VARIANT) : { have: 0, total: fallbackTotalBytes() };
  const totalMB = megabytes(bytes.total);
  const percent = percentOf(bytes.have, bytes.total);
  const haveMB = megabytes(bytes.have);
  if (voiceReady(status)) return { kind: "ready" };
  if (status?.running) return { kind: "downloading", percent, haveMB, totalMB };
  if (opts.starting) return { kind: "starting", totalMB };
  const error = opts.startError ?? status?.error ?? null;
  if (error) return { kind: "failed", error, percent, haveMB, totalMB };
  return { kind: "idle", totalMB, resumable: bytes.have > 0, percent };
}

// The scheduler, so tests can step the loop by hand.
export interface Clock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const POLL_MS = 1000;

export interface VoicePoller {
  // Read now, and keep reading every POLL_MS while the download runs.
  kick(): void;
  // Ask for the download, then poll it. Resolves once the command answered;
  // a refusal is passed to onError, not thrown.
  start(): Promise<void>;
  stop(): void;
}

// One read on open (which also picks up a download already running from
// before the settings view opened), then a read a second while `running`, and
// nothing while idle, failed or ready. A read that throws is skipped quietly:
// off iOS there is no plugin, and on iOS the first read can land before it is
// up; the row then stays on whatever it last showed.
export function createVoicePoller(
  bridge: KokoroBridge,
  onStatus: (s: KokoroStatus) => void,
  onError: (message: string) => void,
  clock: Clock = globalThis,
): VoicePoller {
  let timer: unknown = null;
  let stopped = false;
  let generation = 0;

  const clear = () => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  };

  const read = async (gen: number) => {
    let s: KokoroStatus;
    try {
      s = await kokoroStatus(bridge);
    } catch {
      return;
    }
    if (stopped || gen !== generation) return;
    onStatus(s);
    if (s.running) timer = clock.setTimeout(() => void read(gen), POLL_MS);
  };

  const kick = () => {
    if (stopped) return;
    clear();
    generation += 1;
    void read(generation);
  };

  return {
    kick,
    async start() {
      if (stopped) return;
      try {
        const s = await startKokoroDownload(bridge, [VOICE_VARIANT]);
        if (stopped) return;
        onStatus(s);
      } catch (e) {
        if (!stopped) onError(e instanceof Error ? e.message : String(e));
        return;
      }
      kick();
    },
    stop() {
      stopped = true;
      clear();
    },
  };
}
