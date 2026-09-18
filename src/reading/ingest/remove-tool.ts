// The remove_supplement chat tool (docs/67 「辅助资料」): the reader says "take
// that piece off" and the document a link became is gone — off the book's list,
// out of the library, out of the prep run.
//
// There is no delete button on the Outline. Correcting what the AI took in is
// rare and is already a sentence in the conversation; a button would be a second
// place to maintain for the same act.
//
// Which document the reader means is decided here, by title, the way a citation
// is matched (prep/anchors.ts: citationKey) — the model copies the title out of
// the prompt and may re-wrap it. Everything the removal touches is injected, so
// what each answer says is pinned by a test with no library and no pipeline.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../legion/execute/turn";
import { citationKey } from "../prep/anchors";

/** A supplement, as much of one as this tool needs. */
export interface SupplementListing {
  hash: string;
  title: string;
}

export interface SupplementToolDeps {
  /** The book's supplements, read at call time: one may have arrived mid-turn. */
  list(): Promise<readonly SupplementListing[]>;
  /** Take this one away, everything it left behind included. */
  remove(one: SupplementListing): Promise<void>;
}

/**
 * Pure: which supplement a title names. Exact match first, then the one whose
 * title contains it — a model asked to remove "the Anthropic piece" writes a
 * fragment. Null when nothing matches, and null when more than one does loosely:
 * this deletes a document, so an ambiguous name is answered with a question
 * rather than a guess.
 */
export function matchSupplement(
  query: string,
  supplements: readonly SupplementListing[],
): SupplementListing | null {
  const wanted = citationKey(query);
  if (!wanted) return null;
  const exact = supplements.find((s) => citationKey(s.title) === wanted);
  if (exact) return exact;
  const loose = supplements.filter((s) => citationKey(s.title).includes(wanted));
  return loose.length === 1 ? loose[0] : null;
}

// The line added to the companion prompt wherever the tool is mounted.
export const REMOVE_SUPPLEMENT_PROMPT =
  "When the reader asks for one of this book's supplements to be taken away " +
  '("delete that piece", "这篇资料删掉"), call remove_supplement with its title. ' +
  "Only when they ask: it deletes the document and everything on it.";

export function buildSupplementTools(deps: SupplementToolDeps): AgentTool[] {
  return [
    {
      name: "remove_supplement",
      label: (args) => args.title ? `Removing “${args.title}”` : "Removing a supplement",
      effect: "write",
      description:
        "Take one of this book's supplements away: it leaves the Outline, the " +
        "library and this book's prep list, with its marks and side conversations. " +
        "Takes the supplement's title as it is listed. Only when the reader asks " +
        "for it — this deletes a document and cannot be undone.",
      parameters: Type.Object({
        title: Type.String({ description: "The supplement's title, as listed." }),
      }),
      execute: async (args) => {
        const query = String(args.title ?? "").trim();
        const supplements = await deps.list();
        if (supplements.length === 0) {
          return { text: "This book has no supplements to remove.", receipt: null };
        }
        const found = matchSupplement(query, supplements);
        if (!found) {
          const titles = supplements.map((s) => `"${s.title}"`).join(", ");
          return {
            text: `There is no supplement called "${query}" here. This book has: ${titles}.`,
            receipt: null,
          };
        }
        await deps.remove(found);
        return {
          text:
            `Removed "${found.title}". It is off the Outline and out of the library, and ` +
            `you can no longer read it.`,
          receipt: { label: "Removed a supplement", summary: found.title },
        };
      },
    },
  ];
}
