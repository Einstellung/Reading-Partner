// App settings (the default conversation provider/model). Provider credentials
// live in the AI layer; this only stores which provider/model a new call uses.
// Persisted to AppData/settings.json, debounced, with failures surfaced.

import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

const SETTINGS_FILE = "settings.json";
const SAVE_DEBOUNCE = 500;

export interface Settings {
  defaultProviderId: string | null;
  defaultModelId: string | null;
  // Optional Semantic Scholar API key. When set, prep fetches use it instead of
  // the shared free rate-limit pool.
  semanticScholarApiKey: string | null;
}

const DEFAULTS: Settings = {
  defaultProviderId: null,
  defaultModelId: null,
  semanticScholarApiKey: null,
};

let timer: number | null = null;
let onError: (e: unknown) => void = () => {};
export function onSettingsSaveError(handler: (e: unknown) => void): void {
  onError = handler;
}

async function ensureDir(): Promise<void> {
  try {
    if (!(await exists("", { baseDir: BaseDirectory.AppData }))) {
      await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
    }
  } catch {
    // A real problem resurfaces on the write below.
  }
}

export async function loadSettings(): Promise<Settings> {
  try {
    if (!(await exists(SETTINGS_FILE, { baseDir: BaseDirectory.AppData }))) return { ...DEFAULTS };
    const parsed = JSON.parse(
      await readTextFile(SETTINGS_FILE, { baseDir: BaseDirectory.AppData }),
    ) as Partial<Settings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

// Debounced write; a failure is reported (never silently lost, pitfall 09).
export function saveSettings(settings: Settings): void {
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    (async () => {
      await ensureDir();
      await writeTextFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), {
        baseDir: BaseDirectory.AppData,
      });
    })().catch((e) => onError(e));
  }, SAVE_DEBOUNCE);
}
