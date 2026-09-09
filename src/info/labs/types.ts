// A research room (docs/63 研究室): a standing question the reader wants
// followed, with a charter that says where its field of view ends. The lab is
// the unit everything else on the info side hangs off — a source is claimed by a
// lab, a headline hits a lab's observables, a picture belongs to one lab.
//
// Studies (专项组) are the second kind kept in the same file: a lab with an end
// date. Only "lab" is minted this release; the kind is here so the file does not
// have to change shape when studies arrive.

export type LabKind = "lab" | "study";
export type LabStatus = "active" | "archived";

// What the room is for, drafted by the AI out of the conversation and corrected
// by talking. The reader's own language, not a prompt fragment.
export interface Charter {
  // 视野边界: one paragraph saying what is inside the room's field of view.
  scope: string;
  // The questions the room exists to answer.
  questions: string[];
  // Where drafts out of this room would be filed. Unused this release.
  topicId: string | null;
}

export interface Lab {
  // "lab-" + 8 lowercase hex.
  id: string;
  name: string;
  // Only "lab" is minted this release.
  kind: LabKind;
  status: LabStatus;
  charter: Charter;
  // The source descriptor ids this lab claims. [] means it claims nothing yet,
  // and labsForSource then offers it every source nobody else has claimed.
  sources: string[];
  createdAt: number;
  archivedAt?: number;
}

export const LABS_VERSION = 1 as const;

export interface LabsFile {
  version: typeof LABS_VERSION;
  labs: Lab[];
}
