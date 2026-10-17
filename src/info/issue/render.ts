// An issue plan as the bindery's sectioned document (docs/info/88 「简报书」):
// the typographic cover (docs/67), the contents page, one section per entry,
// the Notes and the Annex. Pure, and the same plan gives the same input, so
// buildSectionedEpub gives the same bytes and a rebuilt issue is the same
// library entry.
//
// Every label here is the program's, in the book's language (the locale the
// issue was assembled under, fixed in the EPUB: an issue is immutable). Only
// the conclusions, paragraphs, unknowns and panoramas are a model's, and the
// result files have already checked their numbers.

import { typographicCover } from "../../workshop/bindery/cover-svg";
import type { SectionedEpubInput } from "../../workshop/bindery/build-article";
import type { Locale } from "../../i18n/locale";
import { translate, type Params } from "../../i18n/translate";
import { factsLine } from "../topic-search/facts-line";
import type { TopicSearchResultItem } from "../topic-search/result-types";
import { itemLabel, type IssuePlan, type PlannedAnnex, type PlannedItem } from "./plan";

/** Characters of a title kept as an entry's heading. */
const HEADING_CHARS = 100;

export interface IssueMeta {
  number: number;
  /** YYYY-MM-DD. */
  date: string;
  /** The book's language: every label, date and count line is drawn in it. */
  locale: Locale;
}

function dateIn(date: string, locale: Locale, options: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "Thursday, October 15, 2026" in English, the locale's own long form elsewhere. */
export function longDate(date: string, locale: Locale): string {
  return dateIn(date, locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function shortDate(date: string, locale: Locale): string {
  return dateIn(date, locale, { month: "short", day: "numeric" });
}

/** The box item's line (88 「简报的对话」): "Oct 15 brief · 4 items". */
export function issueCoverLine(date: string, items: number, locale: Locale): string {
  return translate(locale, "info.issue.book.coverLine", { date: shortDate(date, locale), count: items });
}

export function issueTitle(meta: IssueMeta): string {
  return translate(meta.locale, "info.issue.book.title", { number: meta.number, date: longDate(meta.date, meta.locale) });
}

/** The name the shelf and the reader show: "Daily Brief No. 7 · Oct 15". */
export function issueBookName(meta: IssueMeta): string {
  return translate(meta.locale, "info.issue.book.name", { number: meta.number, date: shortDate(meta.date, meta.locale) });
}

/** The file name the library entry is filed under (not shown; one spelling in every language). */
export function issueFileName(meta: Pick<IssueMeta, "number" | "date">): string {
  return `Daily Brief ${meta.date} No. ${meta.number}.epub`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function cut(s: string, n: number): string {
  const chars = [...s];
  return chars.length <= n ? s : `${chars.slice(0, n - 1).join("")}…`;
}

function link(url: string, text: string): string {
  return `<a href="${esc(url)}">${esc(text)}</a>`;
}

/**
 * A catalog message as HTML: its text escaped, with `slots` (ready-made markup,
 * a link) put in where the message has {name}. The markup goes in after the
 * escaping, so a translation cannot reorder it into something broken.
 */
function fill(locale: Locale, key: string, params: Params = {}, slots: Record<string, string> = {}): string {
  const marks = Object.fromEntries(Object.keys(slots).map((k) => [k, `\u0001${k}\u0002`]));
  let out = esc(translate(locale, key, { ...params, ...marks }));
  for (const [k, html] of Object.entries(slots)) out = out.replace(`\u0001${k}\u0002`, () => html);
  return out;
}

// Spine documents are text/section-NNN.xhtml, one per section, in order (bindery).
function sectionHref(index: number): string {
  return `section-${String(index + 1).padStart(3, "0")}.xhtml`;
}

function linksLine(item: TopicSearchResultItem, locale: Locale): string {
  const out: string[] = [];
  if (item.links.original) out.push(fill(locale, "info.issue.book.original", {}, { link: link(item.links.original, item.title) }));
  const posts = item.links.posts.slice(0, 3).map((p) => link(p.url, `@${p.handle}`));
  if (posts.length) out.push(fill(locale, item.links.original ? "info.issue.book.via" : "info.issue.book.post", {}, { links: posts.join(", ") }));
  return out.length ? `<p><small>${out.join(" · ")}</small></p>` : "";
}

function verifyLines(item: TopicSearchResultItem, locale: Locale): string[] {
  const out: string[] = [];
  for (const d of item.verify.discrepancies) {
    out.push(
      d.verdict === "mismatch"
        ? `<p><strong>${fill(locale, "info.issue.book.differHead")}</strong> ${fill(locale, "info.issue.book.differBody", { says: d.says, difference: d.difference ?? "" }).trim()}</p>`
        : `<p><strong>${fill(locale, "info.issue.book.absentHead")}</strong> ${fill(locale, "info.issue.book.absentBody", { says: d.says })}</p>`,
    );
  }
  if (item.verify.status === "unread") {
    const reason = item.verify.reason ?? translate(locale, "info.issue.book.unreadUnknown");
    out.push(`<p><small>${fill(locale, "info.issue.book.unread", { reason })}</small></p>`);
  }
  return out;
}

function continuingLine(item: TopicSearchResultItem, locale: Locale): string {
  const c = item.continuing;
  if (!c) return "";
  const text = fill(locale, "info.issue.book.stillAttention", {
    likesBefore: c.before.likes ?? 0,
    likesAfter: c.after.likes ?? 0,
    repostsBefore: c.before.reposts ?? 0,
    repostsAfter: c.after.reposts ?? 0,
  });
  return `<p><small>${text}</small></p>`;
}

/** The words an item stands under in the book: its section's heading, or the start of its Note. */
export function itemHeading(item: Pick<TopicSearchResultItem, "title">): string {
  return cut(item.title, HEADING_CHARS);
}

function entryHtml(p: PlannedItem, locale: Locale): string {
  const { item } = p;
  return [
    `<p><small>${esc(itemLabel(p))}</small></p>`,
    item.summary ? `<p><em>${esc(item.summary)}</em></p>` : "",
    ...(item.body ?? []).map((para) => `<p>${esc(para)}</p>`),
    item.unknown ? `<p><strong>${fill(locale, "info.issue.book.unknown")}</strong> ${esc(item.unknown)}</p>` : "",
    `<p><small>${esc(factsLine(item.facts, locale))}</small></p>`,
    continuingLine(item, locale),
    ...verifyLines(item, locale),
    linksLine(item, locale),
  ]
    .filter(Boolean)
    .join("\n");
}

function noteHtml(p: PlannedItem, locale: Locale): string {
  const { item } = p;
  return [
    `<p><strong>${fill(locale, "info.issue.book.noteHead", { label: itemLabel(p), title: cut(item.title, HEADING_CHARS) })}</strong></p>`,
    item.summary ? `<p>${esc(item.summary)}</p>` : "",
    `<p><small>${esc(factsLine(item.facts, locale))}</small></p>`,
    continuingLine(item, locale),
    linksLine(item, locale),
  ]
    .filter(Boolean)
    .join("\n");
}

function annexHtml(a: PlannedAnnex): string {
  // The panorama names items E1, E2 …; in the book they are numbered notes.
  const order: string[] = [];
  const text = a.text.replace(/\bE\d+\b/g, (id) => {
    if (!a.cites.some((c) => c.id === id)) return id;
    if (!order.includes(id)) order.push(id);
    return `[${order.indexOf(id) + 1}]`;
  });
  const titles = order.map((id) => a.cites.find((c) => c.id === id)!.title);
  return [
    ...text.split(/\n{2,}/).map((para) => `<p>${esc(para.trim())}</p>`),
    titles.length ? `<ol>${titles.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The document for buildSectionedEpub: contents, entries, Notes, Annex, in that order. */
export function issueEpubInput(plan: IssuePlan, meta: IssueMeta): SectionedEpubInput {
  const locale = meta.locale;
  const entryStart = 1;
  const notesAt = entryStart + plan.entries.length;
  const annexAt = notesAt + (plan.notes.length ? 1 : 0);
  const notesHeading = translate(locale, "info.issue.book.notes");
  const annexHeading = (topic: string) => translate(locale, "info.issue.book.annex", { topic });
  const contents: string[] = [];
  contents.push(
    `<ol>${plan.entries
      .map(
        (p, i) =>
          `<li>${fill(locale, "info.issue.book.entryLine", { summary: p.item.summary ?? p.item.title }, { link: link(sectionHref(entryStart + i), itemLabel(p)) })}</li>`,
      )
      .join("\n")}</ol>`,
  );
  if (plan.notes.length) {
    const titles = plan.notes.map((p) => translate(locale, "info.issue.book.noteHead", { label: itemLabel(p), title: cut(p.item.title, 60) }));
    contents.push(`<p>${fill(locale, "info.issue.book.notesLine", { titles: titles.join("; ") }, { link: link(sectionHref(notesAt), notesHeading) })}</p>`);
  }
  plan.annex.forEach((a, i) => {
    contents.push(`<p>${fill(locale, "info.issue.book.annexLine", {}, { link: link(sectionHref(annexAt + i), annexHeading(a.topic)) })}</p>`);
  });
  // A first look's first part: the slow sources follow in an issue of their own.
  for (const a of plan.awaiting) {
    contents.push(`<p><small>${fill(locale, "info.issue.book.awaiting", { topic: a.topic, sources: a.sources.join(", ") })}</small></p>`);
  }
  const sections: SectionedEpubInput["sections"] = [
    { heading: translate(locale, "info.issue.book.contents"), html: contents.join("\n") },
    ...plan.entries.map((p) => ({ heading: cut(p.item.title, HEADING_CHARS), html: entryHtml(p, locale) })),
    ...(plan.notes.length ? [{ heading: notesHeading, html: plan.notes.map((p) => noteHtml(p, locale)).join("\n<p>* * *</p>\n") }] : []),
    ...plan.annex.map((a) => ({ heading: annexHeading(a.topic), html: annexHtml(a) })),
  ];
  const names = plan.topics.map((t) => t.name);
  return {
    title: issueTitle(meta),
    byline: names.join(", "),
    sourceUrl: "",
    publishedAt: meta.date,
    language: locale,
    sections,
    images: [],
    cover: {
      svg: typographicCover({
        kicker: translate(locale, "info.issue.book.coverKicker"),
        date: translate(locale, "info.issue.book.coverNumber", { number: meta.number }),
        title: longDate(meta.date, locale),
        footer: names,
      }),
    },
  };
}
