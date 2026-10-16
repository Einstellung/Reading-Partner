// The facts line as the book prints it (docs/info/88 「简报书」): compact, in
// the book's language. The full text for the prompt and the number check stays
// `factsText` (compose.ts); the book gets fewer authors and date-only dates,
// and nothing in it is a number the full text does not hold.

import { translate } from "../../i18n/translate";
import type { Locale } from "../../i18n/locale";
import type { ResultFacts } from "./result-types";

/** Authors the book names before "et al.". */
export const BOOK_AUTHORS = 3;

/** YYYY-MM-DD of an ISO timestamp or epoch ms; the text as given when it is not a date. */
export function dateOnly(value: string | number): string {
  if (typeof value === "string") {
    const m = /^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/.exec(value.trim());
    if (m) return m[1];
  }
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? String(value) : at.toISOString().slice(0, 10);
}

/** The facts line for the page: paper authors cut to three, every date a day. */
export function factsLine(f: ResultFacts, locale: Locale): string {
  const tr = (key: string, params?: Record<string, string | number>) => translate(locale, key, params);
  const count = (key: string, n: number | null | undefined) => (n == null ? null : tr(key, { count: n }));
  switch (f.kind) {
    case "paper": {
      const authors =
        f.authors.length > BOOK_AUTHORS
          ? tr("info.issue.facts.etAl", { names: f.authors.slice(0, BOOK_AUTHORS).join(", ") })
          : f.authors.join(", ");
      return [tr("info.issue.facts.arxiv", { id: f.arxivId }), authors, f.publishedAt ? dateOnly(f.publishedAt) : tr("info.issue.facts.dateUnknown")]
        .filter(Boolean)
        .join("; ");
    }
    case "repo": {
      if (!f.lookedUp) return `${f.fullName}; ${tr("info.issue.facts.notLookedUp")}`;
      const release = f.release
        ? [tr("info.issue.facts.release", { tag: f.release.tag }), f.release.publishedAt ? dateOnly(f.release.publishedAt) : ""].filter(Boolean).join(" ")
        : null;
      return [
        f.fullName,
        count("info.issue.facts.stars", f.stars),
        count("info.issue.facts.forks", f.forks),
        f.lastCommitAt ? tr("info.issue.facts.lastCommit", { date: dateOnly(f.lastCommitAt) }) : null,
        release,
        f.license ? tr("info.issue.facts.license", { license: f.license }) : null,
      ]
        .filter(Boolean)
        .join("; ");
    }
    case "page":
      return [f.host, f.author, f.publishedAt ? dateOnly(f.publishedAt) : null].filter(Boolean).join("; ");
    case "post": {
      const c = f.counts;
      return [
        `@${f.handle}`,
        dateOnly(f.postedAt),
        [count("info.issue.facts.likes", c.likes ?? 0), count("info.issue.facts.reposts", c.reposts ?? 0), count("info.issue.facts.replies", c.replies ?? 0)].join(", "),
      ].join("; ");
    }
  }
}
