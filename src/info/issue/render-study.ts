// One version of a study's brief as the bindery's sectioned document
// (docs/info/91 「一份简报」「条目格式」「这次更新」): from the second version on,
// 「This update」 first; then the front page, the contents (pinned, main, the
// Notes), one page per pinned or main entry in its seven parts, the Notes, and
// the version's panorama. Pure, so a version rebuilt is the same bytes.
//
// Every label and every line the program can know (the sources, the window,
// the counts, the read depth, what changed and because of which words of the
// reader's) is the program's, in the book's language. The sentences are the
// model's, already checked against the sections they cite (entry-parts.ts);
// each cite is a link the reader can tap (study-cites.ts).

import type { Locale } from "../../i18n/locale";
import { translate, type Params } from "../../i18n/translate";
import type { SectionedEpubInput } from "../../workshop/bindery/build-article";
import { typographicCover } from "../../workshop/bindery/cover-svg";
import { factsLine } from "../topic-search/facts-line";
import { SOURCE_NAME } from "../topic-search/pace";
import type { EntryParts, EntryPartName, EntrySentence, PaperDepth, StudyVersion, TopicSearchResultItem } from "../topic-search/result-types";
import type { IssuePlan, PlannedItem } from "./plan";
import { annexHtml, cut, esc, fill, HEADING_CHARS, link, linksLine, longDate, sectionHref, shortDate, verifyLines } from "./render";
import { CITE_CLASS, ITEM_CLASS, citeHref, citeId, citeLabel, itemAnchorId, splitAnchor } from "./study-cites";
import type { StudyIssuePlan, StudyTag } from "./study-plan";

export interface StudyMeta {
  /** The study's issue number, the same for every version. */
  number: number;
  /** The day this version was assembled, YYYY-MM-DD. */
  date: string;
  locale: Locale;
  /** The companion the front page says to talk to. */
  companionName: string;
}

const DAY_MS = 86_400_000;

function s(locale: Locale, name: string, params?: Params): string {
  return translate(locale, `info.issue.book.study.${name}`, params);
}

function f(locale: Locale, name: string, params?: Params, slots?: Record<string, string>): string {
  return fill(locale, `info.issue.book.study.${name}`, params, slots);
}

function studyOf(plan: IssuePlan): StudyIssuePlan {
  if (!plan.study) throw new Error("not a study's plan");
  return plan.study;
}

/** The topic's name, as the book is titled. */
function topicOf(plan: IssuePlan): string {
  return plan.topics[0]?.name ?? "";
}

/** "Version 2". */
export function studyVersionLabel(n: number, locale: Locale): string {
  return s(locale, "version", { n });
}

/** The name the shelf, the library and the reader show: "AI discovery · version 2". */
export function studyBookName(topic: string, n: number, locale: Locale): string {
  return s(locale, "name", { topic, n });
}

/** The file name the library entry is filed under (not shown). */
export function studyBookFile(searchId: string, n: number): string {
  return `Study ${searchId} v${n}.epub`;
}

/** What a version changed, in one line: "3 added · 2 removed · 1 to the Notes · 1 rewritten"; the first version's item count. */
export function studyChangeLine(version: Pick<StudyVersion, "base" | "changes">, items: number, locale: Locale): string {
  if (version.base === null) return s(locale, "firstLine", { count: items });
  const count = (kind: StudyVersion["changes"][number]["kind"]) => version.changes.filter((c) => c.kind === kind).length;
  const parts = (
    [
      ["add", "changeAdd"],
      ["remove", "changeRemove"],
      ["demote", "changeDemote"],
      ["rewrite", "changeRewrite"],
      ["pin", "changePin"],
    ] as const
  )
    .filter(([kind]) => count(kind) > 0)
    .map(([kind, key]) => s(locale, key, { count: count(kind) }));
  return parts.length ? parts.join(" · ") : s(locale, "changeNone");
}

/** The box item's line for a version: "AI discovery · version 2: 3 added · 2 removed". */
export function studyBoxLine(topic: string, n: number, changeLine: string, locale: Locale): string {
  return s(locale, "boxLine", { topic, n, changes: changeLine });
}

function timeIn(at: number, locale: Locale, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options).format(new Date(at));
}

function listOf(names: readonly string[], locale: Locale): string {
  return names.join(locale === "zh-CN" || locale === "ja" ? "、" : ", ");
}

function spanOf(window: { since: number; until: number }, locale: Locale): string {
  const days = Math.max(1, Math.round((window.until - window.since) / DAY_MS));
  if (days >= 350) return s(locale, "spanYears", { count: Math.max(1, Math.round(days / 365)) });
  if (days >= 28) return s(locale, "spanMonths", { count: Math.round(days / 30.44) });
  return s(locale, "spanDays", { count: days });
}

const TAG_KEY: Record<Exclude<StudyTag, null>, string> = {
  new: "tagNew",
  rewritten: "tagRewritten",
  demoted: "tagDemoted",
  pinned: "tagPinned",
};

const DEPTH_KEY: Record<PaperDepth, string> = { full: "depthFull", head: "depthHead", abstract: "depthAbstract" };

/** The read depth of an item: its parts' when written in parts, else its paper's. */
function depthOf(item: TopicSearchResultItem): PaperDepth | null {
  if (item.parts) return item.parts.confidence.read.depth;
  return item.facts.kind === "paper" ? (item.facts.depth ?? null) : null;
}

function isSeed(item: TopicSearchResultItem, study: StudyIssuePlan): boolean {
  return study.seeds.includes(item.key) || item.keys.some((k) => study.seeds.includes(k));
}

/** The small line over an entry or a note: where it stands, how deep it was read, what changed. */
function kicker(p: PlannedItem, study: StudyIssuePlan, locale: Locale): string {
  const placed = study.places[p.item.id];
  const out: string[] = [];
  if (placed?.place === "pinned") out.push(esc(s(locale, isSeed(p.item, study) ? "pinnedSeed" : "pinnedYours")));
  else if (p.subtopic) out.push(esc(p.subtopic));
  const depth = depthOf(p.item);
  if (depth) out.push(esc(s(locale, DEPTH_KEY[depth])));
  if (placed?.tag) out.push(`<strong>${esc(s(locale, TAG_KEY[placed.tag]))}</strong>`);
  return out.join(" · ");
}

interface CiteCounter {
  itemId: string;
  n: number;
}

function citeHtml(anchor: string, study: StudyIssuePlan, counter: CiteCounter, locale: Locale): string {
  const href = citeHref(anchor);
  const parts = splitAnchor(anchor);
  if (!href || !parts) return "";
  const heading = parts.section === null ? study.headings[parts.material] : study.headings[anchor];
  const label = citeLabel(heading, parts.section, (n) => s(locale, "pdfPart", { n }), s(locale, "citeWhole"));
  counter.n++;
  return `<a class="${CITE_CLASS}" id="${citeId(counter.itemId, counter.n)}" href="${href}">${esc(label)}</a>`;
}

function sentenceHtml(sentence: EntrySentence, study: StudyIssuePlan, counter: CiteCounter, locale: Locale): string {
  const cites = sentence.cites.map((c) => citeHtml(c, study, counter, locale)).filter(Boolean);
  const quote = sentence.quote ? ` <q>${esc(sentence.quote)}</q>` : "";
  return `${esc(sentence.text)}${quote}${cites.length ? ` ${cites.join(" ")}` : ""}`;
}

const HAS_DIGIT = /\d/;

/** One part's paragraph: its sentences, or what the read did not give; then what was left out. */
function partHtml(
  name: EntryPartName,
  sentences: readonly EntrySentence[],
  parts: EntryParts,
  study: StudyIssuePlan,
  counter: CiteCounter,
  locale: Locale,
): string[] {
  const abstractOnly = parts.confidence.read.depth === "abstract";
  const out: string[] = [];
  if (sentences.length) out.push(`<p>${sentences.map((x) => sentenceHtml(x, study, counter, locale)).join(" ")}</p>`);
  const dropped = parts.confidence.dropped.filter((d) => d.part === name);
  if (name === "results" && abstractOnly && !sentences.some((x) => HAS_DIGIT.test(x.text))) {
    out.push(`<p><small>${f(locale, "noFigures")}</small></p>`);
  } else if (!sentences.length && !dropped.length) {
    out.push(`<p><small>${f(locale, abstractOnly ? "emptyAbstract" : "emptyRead")}</small></p>`);
  }
  if (dropped.length) {
    const byNumber = name === "results" && dropped.some((d) => d.why === "number");
    out.push(`<p><small>${f(locale, byNumber ? "droppedNumber" : "dropped")}</small></p>`);
  }
  return out;
}

function head(locale: Locale, name: string): string {
  return `<p><strong>${f(locale, name)}</strong></p>`;
}

function readLine(parts: EntryParts, locale: Locale): string {
  const read = parts.confidence.read;
  if (read.depth === "full") return read.cut && read.through ? f(locale, "readCut", { through: read.through }) : f(locale, "readFull");
  if (read.depth === "head") return f(locale, "readHead");
  if (read.depth === "abstract") return f(locale, "readAbstract");
  return "";
}

function partsHtml(item: TopicSearchResultItem, parts: EntryParts, study: StudyIssuePlan, locale: Locale): string[] {
  const counter: CiteCounter = { itemId: item.id, n: 0 };
  const part = (name: EntryPartName, sentences: readonly EntrySentence[]) => partHtml(name, sentences, parts, study, counter, locale);
  const method = parts.method.filter((p) => p.length > 0);
  const methodDropped = parts.confidence.dropped.some((d) => d.part === "method");
  const read = readLine(parts, locale);
  return [
    head(locale, "partBackground"),
    ...part("background", parts.background),
    head(locale, "partPrior"),
    ...part("prior", parts.prior),
    head(locale, "partGap"),
    ...part("gap", parts.gap),
    head(locale, "partMethod"),
    // The story keeps its paragraphs; only its gaps are said once, after it.
    ...method.map((para) => `<p>${para.map((x) => sentenceHtml(x, study, counter, locale)).join(" ")}</p>`),
    ...(method.length && !methodDropped ? [] : part("method", [])),
    head(locale, "partResults"),
    ...part("results", parts.results),
    head(locale, "partRelevance"),
    `<p><strong>${f(locale, "partHelps")}</strong></p>`,
    ...part("helps", parts.relevance.helps),
    `<p><strong>${f(locale, "partCannot")}</strong></p>`,
    ...part("cannot", parts.relevance.cannot),
    head(locale, "partConfidence"),
    ...(read ? [`<p>${read}</p>`] : []),
    ...(parts.confidence.admitted.length || parts.confidence.dropped.some((d) => d.part === "admitted")
      ? [`<p><strong>${f(locale, "partAdmitted")}</strong></p>`, ...part("admitted", parts.confidence.admitted)]
      : []),
    ...(parts.confidence.ours.length || parts.confidence.dropped.some((d) => d.part === "ours")
      ? [`<p><strong>${f(locale, "partOurs")}</strong></p>`, ...part("ours", parts.confidence.ours)]
      : []),
  ];
}

function entryHtml(p: PlannedItem, study: StudyIssuePlan, locale: Locale): string {
  const { item } = p;
  const body = item.parts
    ? partsHtml(item, item.parts, study, locale)
    : [
        ...(item.body ?? []).map((para) => `<p>${esc(para)}</p>`),
        item.unknown ? `<p><strong>${fill(locale, "info.issue.book.unknown")}</strong> ${esc(item.unknown)}</p>` : "",
      ];
  const kick = kicker(p, study, locale);
  return [
    `<div class="${ITEM_CLASS}" id="${itemAnchorId(item.id)}">`,
    kick ? `<p><small>${kick}</small></p>` : "",
    item.summary ? `<p><em>${esc(item.summary)}</em></p>` : "",
    ...body,
    `<p><small>${esc(factsLine(item.facts, locale))}</small></p>`,
    ...verifyLines(item, locale),
    linksLine(item, locale),
    "</div>",
  ]
    .filter(Boolean)
    .join("\n");
}

function noteHtml(p: PlannedItem, study: StudyIssuePlan, locale: Locale): string {
  const { item } = p;
  const kick = kicker(p, study, locale);
  return [
    `<div class="${ITEM_CLASS}" id="${itemAnchorId(item.id)}">`,
    kick ? `<p><small>${kick}</small></p>` : "",
    `<p><strong>${esc(cut(item.title, HEADING_CHARS))}</strong></p>`,
    item.summary ? `<p>${esc(item.summary)}</p>` : "",
    `<p><small>${esc(factsLine(item.facts, locale))}</small></p>`,
    linksLine(item, locale),
    "</div>",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Where each item of the version is, by id: its own page, or the Notes. */
function itemHrefs(plan: IssuePlan, entryStart: number, notesAt: number): Map<string, string> {
  const out = new Map<string, string>();
  plan.entries.forEach((p, i) => out.set(p.item.id, sectionHref(entryStart + i)));
  for (const p of plan.notes) out.set(p.item.id, `${sectionHref(notesAt)}#${itemAnchorId(p.item.id)}`);
  return out;
}

const GROUPS = [
  ["add", "groupAdd"],
  ["remove", "groupRemove"],
  ["demote", "groupDemote"],
  ["rewrite", "groupRewrite"],
  ["pin", "groupPin"],
] as const;

/** 「This update」: what changed from the base, each row with the reader's words that made it. */
function updateHtml(plan: IssuePlan, hrefs: Map<string, string>, locale: Locale): string {
  const study = studyOf(plan);
  const v = study.version;
  const titleOf = new Map([...plan.entries, ...plan.notes].map((p) => [p.item.key, p.item.title]));
  for (const r of v.removed) if (!titleOf.has(r.key)) titleOf.set(r.key, r.title);
  const when = timeIn(v.at, locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const out = [`<p><small>${f(locale, "updateHead", { date: when, base: v.base ?? 1 })}</small></p>`];
  for (const [kind, key] of GROUPS) {
    const rows = v.changes.filter((c) => c.kind === kind);
    if (!rows.length) continue;
    out.push(`<p><strong>${f(locale, key, { count: rows.length })}</strong></p>`);
    const items = rows.map((c) => {
      const title = cut(titleOf.get(c.item) ?? c.item, HEADING_CHARS);
      const id = study.idOfKey[c.item];
      const href = kind === "remove" || !id ? undefined : hrefs.get(id);
      const name = href ? link(href, title) : kind === "remove" ? `<s>${esc(title)}</s>` : esc(title);
      const said = c.line ? study.said[c.line] : undefined;
      return `<li>${name}${said ? `<br />${f(locale, "because", { said })}` : ""}</li>`;
    });
    out.push(`<ul>${items.join("\n")}</ul>`);
  }
  if (v.skipped?.length) out.push(`<p><small>${f(locale, "skipped", { count: v.skipped.length })}</small></p>`);
  return out.join("\n");
}

function frontHtml(plan: IssuePlan, meta: StudyMeta): string {
  const study = studyOf(plan);
  const { locale } = meta;
  const names = study.sources.map((x) => SOURCE_NAME[x] ?? x);
  const out = [
    `<p><small>${f(locale, "kicker")}</small></p>`,
    `<p><small>${f(locale, "dateLine", { n: study.version.n, date: longDate(meta.date, locale) })}</small></p>`,
  ];
  if (study.scope.trim()) out.push(`<p>${f(locale, "asks", { scope: study.scope.trim() })}</p>`);
  const sources = names.length ? f(locale, "sources", { sources: listOf(names, locale), span: spanOf(study.window, locale) }) : "";
  const noX = names.length && !study.sources.includes("x") ? f(locale, "noX") : "";
  if (sources) out.push(`<p><small>${[sources, noX].filter(Boolean).join(" ")}</small></p>`);
  out.push(
    `<p><small>${f(locale, "counts", { main: plan.entries.length - study.pinned, notes: plan.notes.length, pinned: study.pinned })}</small></p>`,
    `<p><small>${f(locale, "invite", { name: meta.companionName })}</small></p>`,
  );
  return out.join("\n");
}

function contentsHtml(plan: IssuePlan, hrefs: Map<string, string>, notesHref: string, annexHrefs: string[], locale: Locale): string {
  const study = studyOf(plan);
  const lines = plan.entries.map((p, i) => {
    const label = i < study.pinned ? s(locale, "pinned") : p.subtopic;
    const head = label ? `<small>${esc(label)}</small> ` : "";
    return `<li>${head}${fill(locale, "info.issue.book.entryLine", { summary: p.item.summary ?? p.item.title }, { link: link(hrefs.get(p.item.id)!, cut(p.item.title, HEADING_CHARS)) })}</li>`;
  });
  const out = [`<ol>${lines.join("\n")}</ol>`];
  if (plan.notes.length) {
    const titles = plan.notes.map((p) => cut(p.item.title, 60));
    out.push(`<p>${fill(locale, "info.issue.book.notesLine", { titles: titles.join("; ") }, { link: link(notesHref, translate(locale, "info.issue.book.notes")) })}</p>`);
  }
  plan.annex.forEach((a, i) => {
    out.push(`<p>${fill(locale, "info.issue.book.annexLine", {}, { link: link(annexHrefs[i], translate(locale, "info.issue.book.annex", { topic: a.topic })) })}</p>`);
  });
  return out.join("\n");
}

/** The document for buildSectionedEpub: [This update], the front page, the contents, entries, Notes, panorama. */
export function studyEpubInput(plan: IssuePlan, meta: StudyMeta): SectionedEpubInput {
  const study = studyOf(plan);
  const { locale } = meta;
  const topic = topicOf(plan);
  const updated = study.version.base !== null;
  const frontAt = updated ? 1 : 0;
  const contentsAt = frontAt + 1;
  const entryStart = contentsAt + 1;
  const notesAt = entryStart + plan.entries.length;
  const annexAt = notesAt + (plan.notes.length ? 1 : 0);
  const hrefs = itemHrefs(plan, entryStart, notesAt);
  const notesHeading = translate(locale, "info.issue.book.notes");
  const sections: SectionedEpubInput["sections"] = [
    ...(updated ? [{ heading: s(locale, "update"), html: updateHtml(plan, hrefs, locale) }] : []),
    { heading: topic, html: frontHtml(plan, meta) },
    {
      heading: translate(locale, "info.issue.book.contents"),
      html: contentsHtml(plan, hrefs, sectionHref(notesAt), plan.annex.map((_, i) => sectionHref(annexAt + i)), locale),
    },
    ...plan.entries.map((p) => ({ heading: cut(p.item.title, HEADING_CHARS), html: entryHtml(p, study, locale) })),
    ...(plan.notes.length ? [{ heading: notesHeading, html: plan.notes.map((p) => noteHtml(p, study, locale)).join("\n<p>* * *</p>\n") }] : []),
    ...plan.annex.map((a) => ({ heading: translate(locale, "info.issue.book.annex", { topic: a.topic }), html: annexHtml(a) })),
  ];
  return {
    title: s(locale, "title", { topic, n: study.version.n, date: longDate(meta.date, locale) }),
    byline: topic,
    sourceUrl: "",
    publishedAt: meta.date,
    language: locale,
    sections,
    images: [],
    cover: {
      svg: typographicCover({
        kicker: s(locale, "kicker"),
        date: studyVersionLabel(study.version.n, locale),
        title: topic,
        footer: [shortDate(meta.date, locale)],
      }),
    },
  };
}
