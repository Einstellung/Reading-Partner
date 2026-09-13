// The reader's statements as a prompt block, for a caller that is not the
// reading conversation (docs/48 消费侧, docs/60): the research rooms' analysts
// and the briefing companion read the same knowledge store the soul does, and
// this is the rendering they get.
//
// Two blocks, because the two kinds answer different questions. Profile
// statements say who this person is and how to pitch something to them; concern
// statements say what they are watching for right now, which is exactly what a
// day's triage sorts by and what a reading turn has no use for. The reading
// turn prints the profile half alone (live/memory-section.ts), so the two
// renderings are deliberately not one function.
//
// Pure, and nothing here is evidence about the world: it is about the person.
// The caller labels it that way (info/analysis/analyst.ts).

import type { Statement } from "./types";

// Live statements of one kind, the reader's own words before what a pass
// concluded — they are not equally revisable, and the model acts on the first
// thing it reads (live/memory-section.ts says the same of the reading turn).
function standing(statements: readonly Statement[], kind: Statement["kind"]): Statement[] {
  const live = statements.filter(
    (s) => s.kind === kind && !s.supersededBy && s.text.trim() !== "",
  );
  return [...live.filter((s) => s.author === "reader"), ...live.filter((s) => s.author !== "reader")];
}

function block(heading: readonly string[], statements: readonly Statement[]): string[] {
  if (statements.length === 0) return [];
  // Every line carries its id so the model can name one when it acts on it, and
  // so the reader can be told which line to argue with.
  return [...heading, ...statements.map((s) => `- ${s.text.trim()} (id ${s.id})`)];
}

/**
 * What is known about the reader, rendered for a prompt. Empty string when
 * nothing is known — a heading over nothing reads as a reader with nothing to
 * them, and the caller prints its own placeholder instead.
 */
export function readerStatementSection(statements: readonly Statement[]): string {
  const profile = standing(statements, "profile");
  const concerns = standing(statements, "concern");
  const out: string[] = [];
  out.push(
    ...block(
      [
        "What this reader has said about themselves, and what has been concluded from",
        "how they read (their own words first):",
      ],
      profile,
    ),
  );
  const watching = block(["What they are keeping an eye on at the moment:"], concerns);
  if (watching.length > 0) {
    if (out.length > 0) out.push("");
    out.push(...watching);
  }
  return out.join("\n");
}
