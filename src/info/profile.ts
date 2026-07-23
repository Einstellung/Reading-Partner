// The reader profile that triage reads (docs/16): a plain-English markdown file
// the user can edit. It is the user's own data, synced between devices. There is
// no factory seed — the software presets no interests. The profile is written
// only when the user (or the onboarding update_profile draft they Apply) puts
// taste into it; until then it is empty and triage judges on an item's own merit.
// Persisted to AppData/info-profile.md.

import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

export const PROFILE_FILE = "info-profile.md";

async function ensureDir(): Promise<void> {
  try {
    if (!(await exists("", { baseDir: BaseDirectory.AppData }))) {
      await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
    }
  } catch {
    // A real problem resurfaces on the write below.
  }
}

// Load the profile. No file means no profile yet — return empty (nothing is
// seeded or written); triage handles an empty profile universally. A read
// failure returns empty too, never blocking a briefing.
export async function loadProfile(): Promise<string> {
  try {
    if (!(await exists(PROFILE_FILE, { baseDir: BaseDirectory.AppData }))) {
      return "";
    }
    return await readTextFile(PROFILE_FILE, { baseDir: BaseDirectory.AppData });
  } catch {
    return "";
  }
}

export async function saveProfile(text: string): Promise<void> {
  await ensureDir();
  await writeTextFile(PROFILE_FILE, text, { baseDir: BaseDirectory.AppData });
}
