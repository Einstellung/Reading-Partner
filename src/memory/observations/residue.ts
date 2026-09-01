// Tool-call syntax that leaked into an observation body, and how it is taken
// back out. Moved here from reading/lecture/stuck.ts unchanged: the lecture
// prompt cleaned it on the way out, which left the file dirty and left the
// anchors the model had written inside the XML invisible to every index. The
// write path has to reach it too, and memory/ cannot be imported from a domain
// — so it lives where both sides can see it.

import type { EvidenceAnchors } from "./types";

// Real entries on disk end with a stray `</body>` and a parameter tag: written
// by a model that was mid-tool-call when it wrote the observation. Harmless on
// disk, confusing in a prompt that is itself about to describe tools.
const TOOL_RESIDUE =
  /<\/?(?:antml:)?(?:body|parameter|function_calls|invoke|function_results|result)\b[^>]*>/gi;

export function stripToolResidue(body: string): string {
  const lines: string[] = [];
  for (const raw of body.split("\n")) {
    TOOL_RESIDUE.lastIndex = 0;
    const cleaned = raw.replace(TOOL_RESIDUE, "");
    // A line that was nothing but a tag goes with it: leaving the blank behind
    // turns one stray tag into a paragraph break in the middle of a sentence.
    if (cleaned.trim() === "" && raw.trim() !== "") continue;
    if (cleaned.trim() === "" && lines[lines.length - 1]?.trim() === "") continue;
    lines.push(cleaned);
  }
  return lines.join("\n").trim();
}

// An anchor list the model wrote inside the leaked XML rather than through the
// tool call. The payload is a JSON array of ids and holds no tag of its own, so
// `[^<]*` stops it at the next tag or at the end of the body without the
// non-greedy-to-end-of-string trap.
const RESIDUE_ANCHORS =
  /<(?:antml:)?parameter\s+name="(annotationIds|messageIds)"[^>]*>([^<]*)(?:<\/(?:antml:)?parameter>)?/gi;

// The ids inside one such payload. Quoted first, because that is every one of
// them on the owner's store; the unquoted fallback costs a line and covers a
// model that dropped the quotes.
function idsIn(payload: string): string[] {
  const quoted = [...payload.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim());
  if (quoted.length > 0) return quoted.filter(Boolean);
  return payload
    .split(/[[\],\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface CleanedBody {
  body: string;
  anchors: EvidenceAnchors;
}

function merge(into: readonly string[], from: readonly string[]): string[] {
  const out = [...into];
  for (const id of from) if (!out.includes(id)) out.push(id);
  return out;
}

// A body on its way to disk, with the tool-call residue taken out of it and the
// anchors that were buried in that residue added to the entry's own.
//
// Both halves matter and the second is the one that was invisible: an id the
// model wrote inside a `<parameter name="annotationIds">` block never reached
// the frontmatter, so no anchor index — not the lecture's, not the panel's, not
// the sibling lookup — could see the evidence the observation was actually
// built on. Cleaning at read time, which is where this used to happen and only
// for the lecture prompt, left both the dirty file and the lost anchors.
//
// What it finds is not judged: an id that resolves against nothing is stored
// exactly as the model wrote it. Deciding that is a gate of its own, and its
// design waits on why 74 of the message anchors already stored resolve to
// nothing.
export function cleanObservationBody(body: string, anchors: EvidenceAnchors): CleanedBody {
  const annotationIds: string[] = [];
  const messageIds: string[] = [];
  RESIDUE_ANCHORS.lastIndex = 0;
  const stripped = body.replace(RESIDUE_ANCHORS, (_all, field: string, payload: string) => {
    const found = idsIn(payload);
    if (field.toLowerCase() === "annotationids") annotationIds.push(...found);
    else messageIds.push(...found);
    // The whole block goes, payload included. stripToolResidue keeps a tag's
    // inner text — right for `<parameter name="summary">x</parameter>`, wrong
    // here, where the text is a JSON array that has just been read into the
    // anchors and would otherwise be left standing in the prose.
    return "";
  });
  return {
    body: stripToolResidue(stripped),
    anchors: {
      annotationIds: merge(anchors.annotationIds, annotationIds),
      messageIds: merge(anchors.messageIds, messageIds),
    },
  };
}
