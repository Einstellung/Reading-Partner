// App settings (the default conversation provider/model). Provider credentials
// live in the AI layer; this only stores which provider/model a new call uses.
// Persisted to AppData/settings.json, debounced, with failures surfaced.

import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { readGuardedJson, writeTextAtomic, type GuardedRead } from "./atomic-fs";
import { createDebouncedWriter } from "./debounced-writer";
import { observeAppExit } from "./lifecycle";
import { reportStoreError } from "./store-errors";

// Exported so a shell can recognise its own file among the paths a sync pull
// wrote (settingsAfterPull below).
export const SETTINGS_FILE = "settings.json";
const SAVE_DEBOUNCE = 500;

// The thinking levels we expose in the UI. pi-ai supports more ("minimal",
// "xhigh", "max"); we keep the subset small. "off" means don't pass reasoning at
// all. On adaptive-thinking models (Claude 4.5+) the level is an effort hint —
// the model still decides per-request whether and how much to think.
export type ThinkingSetting = "off" | "low" | "medium" | "high";

// Map a setting to pi-ai's ThinkingLevel. "off" -> undefined (omit reasoning).
export function toReasoning(setting: ThinkingSetting): ThinkingLevel | undefined {
  return setting === "off" ? undefined : setting;
}

// The language the AI writes its user-facing output in. "auto" mirrors the
// user's own language (the default, no instruction added); every other value
// pins output to that language across chat, notes, slides, and the briefing.
export type AiLanguage =
  | "auto"
  | "en"
  | "zh-CN"
  | "ja"
  | "ko"
  | "es"
  | "fr"
  | "de"
  | "pt"
  | "ru";

// The native name each language is labelled with, in the UI dropdown and inside
// the prompt instruction itself.
const AI_LANGUAGE_NAMES: Record<Exclude<AiLanguage, "auto">, string> = {
  en: "English",
  "zh-CN": "简体中文",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
  ru: "Русский",
};

// Options for the settings dropdown, in display order. "auto" leads.
export const AI_LANGUAGE_OPTIONS: { value: AiLanguage; label: string }[] = [
  { value: "auto", label: "Auto (match my language)" },
  ...(Object.keys(AI_LANGUAGE_NAMES) as Exclude<AiLanguage, "auto">[]).map((value) => ({
    value,
    label: AI_LANGUAGE_NAMES[value],
  })),
];

// Which language the phone listens for when dictating on device (docs/15).
//
// BCP-47 as SpeechTranscriber spells it, because the value is passed straight to
// the plugin and matched against `SpeechTranscriber.supportedLocales` — the only
// test that means anything there (docs/33).
//
// There is no "auto". Following the device's own language is what produced
// eleven holds of Chinese speech transcribed by the en-US model on 2026-08-17
// ("注意力机制取代了循环结构" came back as "2 E D, teacher, Chidalo, Shun."), because
// this reader's phone is en-US and they talk to the AI in Chinese. Getting it
// wrong is not a degraded transcript, it is a confident wrong one.
export type DictationLocale = "zh-CN" | "en-US";

// Two entries, hardcoded, and it should be more. The device really supports
// thirty (docs/33) and the honest list is `SpeechTranscriber.supportedLocales`,
// but reading it from the webview needs a command the plugin does not have, and
// adding one to widen a dropdown was not worth the surface. These two are the
// ones this reader uses; widen it when the list can be asked for.
export const DICTATION_LOCALE_OPTIONS: { value: DictationLocale; label: string }[] = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English (US)" },
];

// One sentence appended to a system prompt to pin user-facing output to the
// chosen language. Empty for "auto" (no instruction — the surface keeps its own
// default, usually mirroring the user's language).
export function languageInstruction(aiLanguage: AiLanguage): string {
  if (aiLanguage === "auto") return "";
  const name = AI_LANGUAGE_NAMES[aiLanguage];
  return `Respond in ${name}. All user-facing output must be written in ${name}.`;
}

// The native display name for a set language, or null for "auto". Prompt
// builders that already hardcode an output language in a sentence use this to
// template the target language into that same sentence, instead of appending a
// second, standalone pin that would contradict the hardcoded one. The prompt
// then carries exactly one language directive.
export function aiLanguageName(aiLanguage: AiLanguage): string | null {
  return aiLanguage === "auto" ? null : AI_LANGUAGE_NAMES[aiLanguage];
}

export interface Settings {
  defaultProviderId: string | null;
  defaultModelId: string | null;
  // Optional Semantic Scholar API key. When set, prep fetches use it instead of
  // the shared free rate-limit pool.
  semanticScholarApiKey: string | null;
  // How hard the model thinks for chat/distillation and for lesson prep. Omitted
  // silently on models that don't support reasoning.
  chatThinking: ThinkingSetting;
  prepThinking: ThinkingSetting;
  // Deck-illustration image relay (docs/14). Base URL and model are harmless
  // config and sync freely; the paid key lives in credentials.json (not synced).
  // null falls back to the built-in defaults (see src/reading/slides/imageGen.ts).
  illustrationApiBase: string | null;
  illustrationModel: string | null;
  // Voice-input STT endpoint (docs/15). base/model sync freely; the key lives in
  // credentials.json (not synced). null falls back to the built-in SiliconFlow
  // SenseVoice defaults (see src/ai/voice/config.ts).
  sttApiBase: string | null;
  sttModel: string | null;
  // Which language the phone's on-device dictation listens for (docs/15). A
  // setting rather than the device's own language, because cross-language
  // decoding is total rather than degraded (docs/33): a Chinese sentence spoken
  // into the en-US model comes back as plausible English words, not as bad
  // Chinese, and this reader's phone is en-US while they talk to the AI in
  // Chinese. Defaults to zh-CN for that reason. Desktop ignores it — that path
  // records a WAV and ships it to an STT host, which detects the language
  // itself.
  dictationLocale: DictationLocale;
  // Language the AI writes its user-facing output in. "auto" mirrors the user's
  // own language; every other value pins output to that language.
  aiLanguage: AiLanguage;
  // autoNotes used to be here (docs/09): a switch for "I don't want to spend
  // this". Deleted 2026-08-19 — money is not the constraint, and preparation is
  // now started by the two entries that mean it (reading/prep/trigger.ts), the
  // same reasoning that deleted the classroom switch. An old file still carrying
  // the key rides through load/save as an unknown key, like the two below.
  //
  // backgroundCollect and fingerDraw used to be here and moved to device.json
  // (docs/36): one is "does this machine collect", the other "does this machine
  // have a stylus", and neither is an answer the account can give for every
  // device. The keys are deliberately not deleted from the file — a device still
  // on the old build reads its own copy, and a fields merge that saw one side
  // drop a key would carry the deletion to it. They ride through load/save as
  // unknown keys; nothing here reads them after the one-time migration in
  // device.ts.
}

export const DEFAULT_SETTINGS: Settings = {
  defaultProviderId: null,
  defaultModelId: null,
  semanticScholarApiKey: null,
  chatThinking: "low",
  prepThinking: "medium",
  illustrationApiBase: null,
  illustrationModel: null,
  sttApiBase: null,
  sttModel: null,
  dictationLocale: "zh-CN",
  aiLanguage: "auto",
};

const DEFAULTS = DEFAULT_SETTINGS;

// Everything the store reaches outside itself: the file, the clock, and the way
// out of the app. Passed in rather than imported, so a test can run the real
// store against an in-memory file on a fake clock. The alternative — swapping
// atomic-fs out with mock.module — rewrites the module registry for every other
// test file that shares the worker, and bun never unwinds it (pitfall 119).
export interface SettingsIo {
  // The guarded read, so the quarantine policy stays in atomic-fs. "corrupt"
  // with no quarantine copy is the case that blocks writing.
  read: () => Promise<GuardedRead<Partial<Settings>>>;
  write: (contents: string) => Promise<void>;
  schedule: (fn: () => void, ms: number) => number;
  cancel: (id: number) => void;
  // Bound once, on the first save: the last 500ms of a session are settings the
  // user changed and then quit, and on iOS the webview is suspended without the
  // timer ever firing. Not bound at import time, so a headless caller that only
  // reads settings never touches the DOM.
  bindExit: (flush: () => void) => void;
  // Where a failed write goes. Passed in like everything else here rather than
  // registered afterwards, so there is no window in which the store has a
  // failure to report and nowhere to report it (store-errors.ts).
  onError: (e: unknown) => void;
}

export interface SettingsStore {
  load: () => Promise<Settings>;
  save: (settings: Settings) => void;
  // Write whatever the debounce is holding and wait for it to land. Anyone about
  // to read settings.json back has to call this first, or they read the file as
  // it was before the last 500ms of edits (see pulledSettings in the shell
  // bootstrap).
  flush: () => Promise<void>;
}

export function createSettingsStore(io: SettingsIo): SettingsStore {
  // The settings a debounce is holding, so the write — which runs later, off the
  // writer's chain — has something to serialise.
  let pending: Settings | null = null;
  // Set when the file exists but could not be read, so the app is running on
  // defaults that would erase real configuration (provider, keys) if written
  // back. Reset on a successful load, which is the only thing that can happen
  // first.
  let blockWrites = false;

  // One file, so one key. The debounce, the single flush on the way out and the
  // chaining of writes in flight are all the shared writer's
  // (debounced-writer.ts); what is left here is what to write and when not to.
  const writer = createDebouncedWriter<string>({
    write: async () => {
      if (blockWrites) {
        throw new Error(`${SETTINGS_FILE} could not be read; refusing to overwrite it`);
      }
      if (pending !== null) await io.write(JSON.stringify(pending, null, 2));
    },
    debounceMs: SAVE_DEBOUNCE,
    onError: io.onError,
    timer: { schedule: io.schedule, cancel: io.cancel },
    exit: io.bindExit,
  });

  // Falling back to the defaults is fine for a missing file and unavoidable for
  // an unreadable one, but it must not become the new truth: unparseable content
  // is quarantined first (in atomic-fs), and an unreadable file blocks saving
  // until a later load succeeds.
  async function load(): Promise<Settings> {
    const read = await io.read();
    blockWrites = read.status === "corrupt" && read.savedAs === null;
    if (read.status === "ok") return { ...DEFAULTS, ...read.value };
    return { ...DEFAULTS };
  }

  // Debounced write; a failure is reported (never silently lost, pitfall 09).
  function save(settings: Settings): void {
    pending = settings;
    writer.schedule(SETTINGS_FILE);
  }

  return { load, save, flush: writer.flush };
}

const store = createSettingsStore({
  read: () =>
    readGuardedJson<Partial<Settings>>(SETTINGS_FILE, (raw) =>
      raw && typeof raw === "object" ? (raw as Partial<Settings>) : null,
    ),
  write: (contents) => writeTextAtomic(SETTINGS_FILE, contents),
  schedule: (fn, ms) => window.setTimeout(fn, ms),
  cancel: (id) => window.clearTimeout(id),
  bindExit: (flush) => {
    if (typeof window === "undefined") return;
    observeAppExit(window, flush);
  },
  onError: (e) => reportStoreError("settings", e),
});

export const loadSettings = (): Promise<Settings> => store.load();
export const saveSettings = (settings: Settings): void => store.save(settings);
export const flushSettings = (): Promise<void> => store.flush();

// What a sync pull does to the settings a shell is holding. A shell keeps
// settings.json whole in memory and every save serialises that whole copy, so a
// field another device changed — merged into the file key by key
// (sync/merge/fields.ts) — is undone by the shell's next save unless the copy is
// read back.
//
//   "ignore" — the pull did not touch settings.json.
//   "adopt"  — read it back now.
//   "defer"  — the settings panel is open, so reading back now would type over
//              the value under the user's hands. The read waits for the panel to
//              close. It cannot simply be dropped: that leaves the shell holding
//              the pre-pull copy, which is the clobber this exists to prevent.
export type SettingsPull = "ignore" | "adopt" | "defer";

export function settingsPullAction(paths: readonly string[], panelOpen: boolean): SettingsPull {
  if (!paths.includes(SETTINGS_FILE)) return "ignore";
  return panelOpen ? "defer" : "adopt";
}
