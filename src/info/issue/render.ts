// An issue plan as the bindery's sectioned document (docs/info/88 「简报书」):
// the typographic cover (docs/67), the contents page, one section per entry,
// the Notes and the Annex. Pure, and the same plan gives the same input, so
// buildSectionedEpub gives the same bytes and a rebuilt issue is the same
// library entry.
//
// Every label here is the program's, in English. Only the conclusions,
// paragraphs, unknowns and panoramas are a model's, and the result files have
// already checked their numbers.

import { typographicCover } from "../../workshop/bindery/cover-svg";
import type { SectionedEpubInput } from "../../workshop/bindery/build-article";
import { factsText } from "../topic-search/compose";
import type { TopicSearchResultItem } from "../topic-search/result-types";
import { itemLabel, type IssuePlan, type PlannedAnnex, type PlannedItem } from "./plan";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Characters of a title kept as an entry's heading. */
const HEADING_CHARS = 100;

export interface IssueMeta {
  number: number;
  /** YYYY-MM-DD. */
  date: string;
}

function parts(date: string): { y: number; m: number; d: number; weekday: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** "Thursday, 15 October 2026". */
export function longDate(date: string): string {
  const p = parts(date);
  return `${DAYS[p.weekday]}, ${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

/** The box item's line (88 「简报的对话」): "Oct 15 brief · 4 items". */
export function issueCoverLine(date: string, items: number): string {
  const p = parts(date);
  return `${MONTHS[p.m - 1].slice(0, 3)} ${p.d} brief · ${items} ${items === 1 ? "item" : "items"}`;
}

export function issueTitle(meta: IssueMeta): string {
  return `Daily Brief No. ${meta.number}, ${longDate(meta.date)}`;
}

/** The file name the library entry is filed under. */
export function issueFileName(meta: IssueMeta): string {
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

// Spine documents are text/section-NNN.xhtml, one per section, in order (bindery).
function sectionHref(index: number): string {
  return `section-${String(index + 1).padStart(3, "0")}.xhtml`;
}

function linksLine(item: TopicSearchResultItem): string {
  const out: string[] = [];
  if (item.links.original) out.push(`Original: ${link(item.links.original, item.title)}`);
  const posts = item.links.posts.slice(0, 3).map((p) => link(p.url, `@${p.handle}`));
  if (posts.length) out.push(`${item.links.original ? "Via" : "Post"}: ${posts.join(", ")}`);
  return out.length ? `<p><small>${out.join(" · ")}</small></p>` : "";
}

function verifyLines(item: TopicSearchResultItem): string[] {
  const out: string[] = [];
  for (const d of item.verify.discrepancies) {
    out.push(
      d.verdict === "mismatch"
        ? `<p><strong>Post and original differ.</strong> The post says ${esc(d.says)}. ${esc(d.difference ?? "")}</p>`
        : `<p><strong>Not in the original.</strong> The post says ${esc(d.says)}.</p>`,
    );
  }
  if (item.verify.status === "unread") out.push(`<p><small>The original was not read: ${esc(item.verify.reason ?? "unknown reason")}.</small></p>`);
  return out;
}

function continuingLine(item: TopicSearchResultItem): string {
  const c = item.continuing;
  if (!c) return "";
  return `<p><small>Still drawing attention: likes ${c.before.likes ?? 0} → ${c.after.likes ?? 0}, reposts ${c.before.reposts ?? 0} → ${c.after.reposts ?? 0}.</small></p>`;
}

function entryHtml(p: PlannedItem): string {
  const { item } = p;
  return [
    `<p><small>${esc(itemLabel(p))}</small></p>`,
    item.summary ? `<p><em>${esc(item.summary)}</em></p>` : "",
    ...(item.body ?? []).map((para) => `<p>${esc(para)}</p>`),
    item.unknown ? `<p><strong>Not yet known.</strong> ${esc(item.unknown)}</p>` : "",
    `<p><small>${esc(factsText(item.facts))}</small></p>`,
    continuingLine(item),
    ...verifyLines(item),
    linksLine(item),
  ]
    .filter(Boolean)
    .join("\n");
}

function noteHtml(p: PlannedItem): string {
  const { item } = p;
  return [
    `<p><strong>${esc(itemLabel(p))}: ${esc(cut(item.title, HEADING_CHARS))}</strong></p>`,
    item.summary ? `<p>${esc(item.summary)}</p>` : "",
    `<p><small>${esc(factsText(item.facts))}</small></p>`,
    continuingLine(item),
    linksLine(item),
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
  const entryStart = 1;
  const notesAt = entryStart + plan.entries.length;
  const annexAt = notesAt + (plan.notes.length ? 1 : 0);
  const contents: string[] = [];
  contents.push(
    `<ol>${plan.entries
      .map((p, i) => `<li>${link(sectionHref(entryStart + i), itemLabel(p))}: ${esc(p.item.summary ?? p.item.title)}</li>`)
      .join("\n")}</ol>`,
  );
  if (plan.notes.length) {
    const titles = plan.notes.map((p) => `${itemLabel(p)}: ${cut(p.item.title, 60)}`);
    contents.push(`<p>${link(sectionHref(notesAt), "Notes")}: ${esc(titles.join("; "))}</p>`);
  }
  plan.annex.forEach((a, i) => {
    contents.push(`<p>${link(sectionHref(annexAt + i), `Annex: ${a.topic}`)}, the panorama of this topic's first look.</p>`);
  });
  const sections: SectionedEpubInput["sections"] = [
    { heading: "Contents", html: contents.join("\n") },
    ...plan.entries.map((p) => ({ heading: cut(p.item.title, HEADING_CHARS), html: entryHtml(p) })),
    ...(plan.notes.length ? [{ heading: "Notes", html: plan.notes.map(noteHtml).join("\n<p>* * *</p>\n") }] : []),
    ...plan.annex.map((a) => ({ heading: `Annex: ${a.topic}`, html: annexHtml(a) })),
  ];
  const names = plan.topics.map((t) => t.name);
  return {
    title: issueTitle(meta),
    byline: names.join(", "),
    sourceUrl: "",
    publishedAt: meta.date,
    language: "en",
    sections,
    images: [],
    cover: {
      svg: typographicCover({ kicker: "Lumen Daily Brief", date: `No. ${meta.number}`, title: longDate(meta.date), footer: names }),
    },
  };
}
