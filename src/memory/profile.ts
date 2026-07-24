// The user profile: a cross-scenario identity document, the system's one durable
// statement about the user. Both scenarios read it — the daily briefing's triage
// (docs/16) and the reading companion — and it is edited only through the chat
// update_profile confirm card. It is the user's own data, synced between devices.
// There is no factory seed: no interests are preset. The profile is written only
// when the user (or the onboarding draft they Apply) puts taste into it; until
// then it is empty and triage judges on an item's own merit.
// Persisted to AppData/user-profile.md.

import {
  BaseDirectory,
  exists,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

export const PROFILE_FILE = "user-profile.md";
// The name an older build wrote (an info-only profile, before it was promoted to
// the cross-scenario identity). loadProfile migrates it once, on first read.
export const LEGACY_PROFILE_FILE = "info-profile.md";

// The profile's shape and size discipline. Injected verbatim into every prompt
// that drafts or revises the profile (the update_profile tool, the info
// companion, first-run onboarding) so the model keeps the document small and
// well-organized rather than appending to it forever.
export const PROFILE_SKELETON_GUIDANCE = [
  "The profile is a short free-text markdown document — the one identity both the",
  "daily briefing and the reading companion share. Organize it under four",
  "conventional sections (omit, or leave empty, any the user has not spoken to):",
  "- Interests: the fields and sub-areas they follow.",
  "- Taste: what they are allergic to, what forms they prefer.",
  "- Background: how deep they are, broken down by field.",
  "- Now: what they are reading, digging into, or preparing right now — each entry",
  "  dated with an absolute month (YYYY-MM).",
  "Keep the whole thing under half a page (~1500 characters). When a new",
  "preference conflicts with an existing line, rewrite that line rather than",
  "adding a second; merge entries of the same kind; tighten any section that",
  "bloats. Refuse to append endlessly — propose a merge instead. Do not silently",
  "drop a stale Now entry: when one looks out of date, ask the user in chat whether",
  "it still holds before changing it. When drafting the first profile, include only",
  "what the user has actually said — no invented taste, unspoken sections left out.",
].join("\n");

// Load the profile. No file means no profile yet — return empty (nothing is
// seeded or written); every reader handles an empty profile. A read failure
// returns empty too, never blocking a briefing.
//
// One-time migration: when the new file is absent but an older build's
// info-profile.md exists, promote its content to user-profile.md and return it.
// The old file is left in place so a device still on the old build keeps reading
// it through the shared synced folder.
export async function loadProfile(): Promise<string> {
  try {
    if (await exists(PROFILE_FILE, { baseDir: BaseDirectory.AppData })) {
      return await readTextFile(PROFILE_FILE, { baseDir: BaseDirectory.AppData });
    }
    if (await exists(LEGACY_PROFILE_FILE, { baseDir: BaseDirectory.AppData })) {
      const legacy = await readTextFile(LEGACY_PROFILE_FILE, { baseDir: BaseDirectory.AppData });
      try {
        await writeTextFile(PROFILE_FILE, legacy, { baseDir: BaseDirectory.AppData });
      } catch {
        // If the promote-write fails, the legacy content is still returned; the
        // next read tries the migration again.
      }
      return legacy;
    }
    return "";
  } catch {
    return "";
  }
}

export async function saveProfile(text: string): Promise<void> {
  await writeTextFile(PROFILE_FILE, text, { baseDir: BaseDirectory.AppData });
}
