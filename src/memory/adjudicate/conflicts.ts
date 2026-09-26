// Which prose conflicts an agent may settle, and finding them on disk (docs/59 §6).
//
// Sync's prose strategy keeps one version of a file two devices both wrote over
// and parks the other beside it as `<stem>.conflict-<digest>.md`, the digest
// taken from the parked bytes (platform/sync/merge). Everything here is about
// those copies: which palace kinds produce one, what the file is for — the
// model is told — and how the file that was kept is written back.
//
// The index of observations is prose to sync but not to anyone else: it is
// rebuilt from the entries after every mutation and its copies are deleted by
// the store that owns it, so it is not in the table. Neither are records,
// fields or cursors: their conflicts have a right answer and stay with the
// deterministic merge.

import { resolvePalace } from "../../palace";

/** How the adjudicated text is written back. */
export type ProseShape =
  /** An observation: frontmatter the store owns, and a summary and body. */
  | "observation"
  /** A file that is its text and nothing else. */
  | "whole";

export interface ProseRole {
  /** The palace kind of the file that was kept. */
  kind: string;
  shape: ProseShape;
  /** What the file is, in a sentence the model is given. */
  about: string;
}

const ROLES: readonly ProseRole[] = [
  {
    kind: "observation",
    shape: "observation",
    about:
      "One observation the reading companion distilled about its reader: a one-line summary and a markdown body, both written by a model from the reader's conversations and edited by later passes.",
  },
  {
    kind: "user-profile",
    shape: "whole",
    about: "The reader's profile, as free markdown. Retired: nothing writes it any more, but the reader may still read it.",
  },
  {
    kind: "info-profile-legacy",
    shape: "whole",
    about: "The reader's old news-briefing profile, as free markdown. Retired; kept for the reader to read.",
  },
  {
    kind: "prep-note",
    shape: "whole",
    about:
      "A lesson-prep note a model wrote about one book or chapter for the reading companion. Derived material: a coherent note matters more than keeping every line.",
  },
];

/** The role of the file at `path`, or null when its conflicts are not adjudicated. */
export function roleFor(path: string): ProseRole | null {
  const kind = resolvePalace(path)?.row.kind;
  return ROLES.find((role) => role.kind === kind) ?? null;
}

/** One parked copy, and the file it is the other version of. */
export interface ProseConflict {
  /** The parked copy: `<stem>.conflict-<digest>.md`. */
  copyPath: string;
  /** The file that was kept. */
  path: string;
  /** The parked bytes' digest, out of the copy's own name. */
  digest: string;
  role: ProseRole;
}

const COPY = /^(.*)\.conflict-([0-9a-f]+)(\.md)$/;

/** Read a copy's name back into the file it was parked beside. Null for anything else. */
export function parseConflictPath(copyPath: string): ProseConflict | null {
  const m = COPY.exec(copyPath);
  if (!m) return null;
  const path = `${m[1]}${m[3]}`;
  // A copy of a copy is not a thing sync makes, and a stem that still carries a
  // marker would read as one.
  if (COPY.test(path)) return null;
  const role = roleFor(path);
  if (!role) return null;
  return { copyPath, path, digest: m[2], role };
}

/**
 * What the run for one conflict is keyed by. Content-derived — the kept file's
 * path and the parked bytes' digest — so two devices that found the same copy
 * name the same run, and the run store derives the same file from it.
 */
export function adjudicationKey(conflict: Pick<ProseConflict, "path" | "digest">): string {
  return `adjudicate:${conflict.path}:${conflict.digest}`;
}

/** The directory listings discovery needs. Paths relative to AppData; "" is the root. */
export interface ConflictListing {
  files(dir: string): Promise<string[]>;
  dirs(dir: string): Promise<string[]>;
}

// Where the adjudicated kinds live: the observations directory, the root for the
// two retired profiles, and each prep directory with its chapters below it.
async function candidateDirs(list: ConflictListing): Promise<string[]> {
  const prep = (await list.dirs("")).filter((name) => name.startsWith("prep-"));
  return ["observations", "", ...prep.flatMap((dir) => [dir, `${dir}/chapters`])];
}

/** Every parked copy of an adjudicated kind on this device, in path order. */
export async function discoverConflicts(list: ConflictListing): Promise<ProseConflict[]> {
  const out: ProseConflict[] = [];
  for (const dir of await candidateDirs(list)) {
    for (const name of await list.files(dir)) {
      if (!name.includes(".conflict-")) continue;
      const conflict = parseConflictPath(dir === "" ? name : `${dir}/${name}`);
      if (conflict) out.push(conflict);
    }
  }
  out.sort((a, b) => (a.copyPath < b.copyPath ? -1 : a.copyPath > b.copyPath ? 1 : 0));
  return out;
}
