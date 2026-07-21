// The reader profile that triage reads (docs/16): a plain-English markdown file
// the user can edit. Seeded on first run and synced between devices (it is the
// user's own data). Persisted to AppData/info-profile.md.

import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

export const PROFILE_FILE = "info-profile.md";

// The first-run seed. Concrete enough that the very first briefing has taste to
// work with; the user edits it freely from there.
export const DEFAULT_PROFILE = `# Reading profile

I want hard technical substance: papers, methods, real results, concrete
industry signals (shipping models, benchmarks that mean something, architecture
details). I am allergic to vendor PR, conference puff pieces, funding-round
theater, and ceremony recaps — filter them out without apology.

Right now I am deep in embodied AI, world models, and LLM research. Surface work
in those areas first, but don't wall me off from a genuinely important result
elsewhere.
`;

async function ensureDir(): Promise<void> {
  try {
    if (!(await exists("", { baseDir: BaseDirectory.AppData }))) {
      await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
    }
  } catch {
    // A real problem resurfaces on the write below.
  }
}

// Load the profile, seeding the file on first run so the user has something to
// edit. A read failure falls back to the seed text (never blocks a briefing).
export async function loadProfile(): Promise<string> {
  try {
    if (!(await exists(PROFILE_FILE, { baseDir: BaseDirectory.AppData }))) {
      await saveProfile(DEFAULT_PROFILE);
      return DEFAULT_PROFILE;
    }
    return await readTextFile(PROFILE_FILE, { baseDir: BaseDirectory.AppData });
  } catch {
    return DEFAULT_PROFILE;
  }
}

export async function saveProfile(text: string): Promise<void> {
  await ensureDir();
  await writeTextFile(PROFILE_FILE, text, { baseDir: BaseDirectory.AppData });
}
