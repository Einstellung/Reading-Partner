// A supplement's citations (docs/67 「辅助资料」). The book's pages are cited
// [p.N]; a supplement's carry its title, [Some Article p.4], which is the paper
// form of prep/anchors.ts with a title where the slug goes.
//
// Titles are matched case-folded and whitespace-collapsed, because the model
// copies the title out of the prompt and may re-wrap it.

import { citationKey } from "../prep/anchors";
import type { SupplementRef } from "../../platform/app/supplements";

// The key itself is the citation grammar's (prep/anchors.ts), which is the other
// side of the same comparison: what the model wrote, against what is listed.
export { citationKey } from "../prep/anchors";

/** The titles a [title p.N] citation may name in this session. */
export function supplementTitles(refs: readonly SupplementRef[]): ReadonlySet<string> {
  return new Set(refs.map((s) => citationKey(s.title)).filter(Boolean));
}

/** The supplement a citation's slug names, or null when it names none of them. */
export function supplementForSlug(
  slug: string,
  refs: readonly SupplementRef[],
): SupplementRef | null {
  const key = citationKey(slug);
  return refs.find((s) => citationKey(s.title) === key) ?? null;
}
