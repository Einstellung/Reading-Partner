// Layer-0 capability probe for the phone-side voice mode (docs/20). Pure
// synchronous feature detection: no permission prompt, no user gesture, no
// audio, no network. It rides along in the iOS simulator smoke build so the
// "can the web layer even reach a microphone on iOS" questions get an answer
// without a device, a signing setup, or a tap.
//
// The simulator answers API presence and secure-context only. Real capture,
// the permission alert, and audio quality still need a device.
//
// Every field is guarded: a missing global, a throwing getter or a hostile
// constructor degrades to a null/false entry. This must never be able to fail
// the smoke gate it is a passenger on.

export interface VoiceCapabilities {
  origin: string | null;
  isSecureContext: boolean;
  // The gate for everything else: navigator.mediaDevices is only exposed in a
  // secure context.
  hasMediaDevices: boolean;
  hasGetUserMedia: boolean;
  hasMediaRecorder: boolean;
  // mime -> MediaRecorder.isTypeSupported(mime). Empty when MediaRecorder is
  // absent.
  mediaRecorderTypes: Record<string, boolean>;
  hasAudioContext: boolean;
  // "suspended" means playback is gated on a user gesture; "running" means
  // wry's autoplay relaxation took effect. "throw" means the constructor threw.
  audioContextState: string | null;
  hasAudioWorklet: boolean;
  hasSpeechRecognition: boolean;
  hasSpeechSynthesis: boolean;
  // WebKit populates the voice list asynchronously on first use, so 0 on a cold
  // read is not proof that synthesis has no voices.
  speechVoices: number | null;
  hasMediaSession: boolean;
  // If false, contentHash() in src/platform/app/library.ts cannot work here.
  hasSubtleCrypto: boolean;
}

const MEDIA_RECORDER_MIMES = [
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/wav",
];

type Unknowns = Record<string, unknown>;

function root(): Unknowns {
  return globalThis as unknown as Unknowns;
}

// Reading a global can itself throw (exotic getters, cross-origin guards), so
// every read goes through here.
function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

export function probeVoiceCapabilities(): VoiceCapabilities {
  const g = root();
  const nav = safe(() => g.navigator as Unknowns | undefined, undefined);
  const media = safe(() => nav?.mediaDevices as Unknowns | undefined, undefined);

  const Recorder = safe(
    () => g.MediaRecorder as (typeof MediaRecorder) | undefined,
    undefined,
  );
  const mediaRecorderTypes: Record<string, boolean> = {};
  if (typeof Recorder === "function" && typeof Recorder.isTypeSupported === "function") {
    for (const mime of MEDIA_RECORDER_MIMES) {
      mediaRecorderTypes[mime] = safe(() => Recorder.isTypeSupported(mime) === true, false);
    }
  }

  const AudioCtor = safe(
    () => (g.AudioContext ?? g.webkitAudioContext) as (typeof AudioContext) | undefined,
    undefined,
  );
  let audioContextState: string | null = null;
  let hasAudioWorklet = false;
  if (typeof AudioCtor === "function") {
    try {
      const ctx = new AudioCtor();
      audioContextState = ctx.state;
      hasAudioWorklet = typeof ctx.audioWorklet !== "undefined";
      // Free the hardware node right away; the smoke run continues after this.
      void Promise.resolve(ctx.close()).catch(() => {});
    } catch {
      audioContextState = "throw";
    }
  }

  const synth = safe(() => g.speechSynthesis as SpeechSynthesis | undefined, undefined);

  return {
    origin: safe(() => (g.location as Location | undefined)?.origin ?? null, null),
    isSecureContext: safe(() => g.isSecureContext === true, false),
    hasMediaDevices: !!media,
    hasGetUserMedia: typeof media?.getUserMedia === "function",
    hasMediaRecorder: typeof Recorder === "function",
    mediaRecorderTypes,
    hasAudioContext: typeof AudioCtor === "function",
    audioContextState,
    hasAudioWorklet,
    hasSpeechRecognition: safe(
      () => "SpeechRecognition" in g || "webkitSpeechRecognition" in g,
      false,
    ),
    hasSpeechSynthesis: typeof safe(() => synth?.speak, undefined) === "function",
    speechVoices: safe(() => (synth ? synth.getVoices().length : null), null),
    hasMediaSession: safe(() => typeof nav?.mediaSession !== "undefined", false),
    hasSubtleCrypto: safe(
      () => typeof (g.crypto as Crypto | undefined)?.subtle?.digest === "function",
      false,
    ),
  };
}
