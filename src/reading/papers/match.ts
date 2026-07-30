// Shared title matching for the fetch tiers (arXiv, OpenAlex, Semantic Scholar).
// A wrong paper is worse than no paper, so a candidate only matches when its
// normalized title equals the wanted one, or one contains the other (subtitle
// drift). Kept in one place so the three clients stay consistent.

export function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// First candidate whose title matches. getTitle extracts the title from each
// candidate shape. Null when none is close enough.
export function pickByTitle<T>(items: T[], title: string, getTitle: (item: T) => string): T | null {
  const want = normalizeTitle(title);
  if (!want) return null;
  for (const item of items) {
    const got = normalizeTitle(getTitle(item) ?? "");
    if (got === want || got.includes(want) || want.includes(got)) return item;
  }
  return null;
}
