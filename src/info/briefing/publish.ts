// What the collector leaves for the readers (docs/36). The day's briefing and
// its article cache stay derived, local and per day; these two files are fixed
// names, replaced whole, and the only info files that travel.
//
//   info-briefing.json  the Briefing, copied as it is. 45 KB.
//   info-bodies.json    the bodies of the items it put in the three tiers.
//
// Two files rather than one because the briefing is small and read on every
// launch while the bodies are two hundred kilobytes read only when an article is
// opened — and because reconcile works per file, so pairing them by hand is what
// keeps a reader from rendering yesterday's text under today's headline. Both
// carry the same date and generatedAt; when they disagree the reader says the
// text is still on its way rather than showing the wrong one.
//
// Inlined images come out of the bodies; external <img> tags stay. Only base64
// was ever the weight — measured 2026-07-23, the three tiers' plain text was
// 96 KB and the same items with contentHtml were 2.9 MB, nearly all of it
// inlined images (one IEEE Spectrum article: 1,570,403 characters of HTML around
// 19,676 characters of article). A remote image costs a URL: measured again on
// a live day, 2026-08-12, 11 bodies carried 81 external images and no inlined
// ones (the img: proxy replaced the base64 inliner), and keeping them took the
// bodies file from 226,926 bytes to 272,006.
//
// What keeping them costs is the App Store 5.2.2 line (docs/36): image_proxy.rs
// is registered on iOS too, so an external <img> that ArticleView points at it
// becomes a real request to the publisher's CDN carrying the article's URL as
// Referer, and `accesses` still covers that. Stripping them cost more: the same
// article would have pictures on a desktop and none on a phone, and keeping it
// on the phone would file that picture-less copy for good, so which version of
// an article the reader owns would depend on the device at hand. To answer 5.2.2
// by not making that request, strip every <img> in buildPublishedBodies instead
// of only the data: ones — that call is the whole switch.

import { BaseDirectory, exists, readTextFile } from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { stripDataImages } from "../extract/sanitize";
import { loadArticles, loadItems, type CachedArticle } from "./store";
import type { Briefing } from "./types";
import type { InfoItem } from "../sources/item";

export const PUBLISHED_BRIEFING_FILE = "info-briefing.json";
export const PUBLISHED_BODIES_FILE = "info-bodies.json";

export interface PublishedBody {
  // Plain text, for the AI. "" when the body was never obtained.
  text: string;
  // Sanitized HTML with the inlined images taken out and the external ones kept,
  // for reading. "" likewise.
  html: string;
  // Whether only a summary was ever obtained (paywall, JS-only page, a source
  // with no full text at all). A first-class state: whoever quotes this has to
  // say the article itself was never read.
  summaryOnly: boolean;
}

export interface PublishedBodies {
  // The briefing these bodies belong to. The pair, not either half, is what a
  // reader trusts.
  date: string;
  generatedAt: number;
  bodies: Record<string, PublishedBody>;
}

// --- pure ------------------------------------------------------------------

// The items a reader can open: the three tiers, in the order the briefing puts
// them. The filtered list is deliberately not here — it was screened out or
// triaged out, its body was never fetched, and the briefing already carries its
// title and the category it was dropped under.
export function tieredItemIds(b: Briefing): string[] {
  return [
    ...b.mustRead.map((r) => r.itemId),
    ...b.oneLiners.map((r) => r.itemId),
    ...b.outOfLane.map((r) => r.itemId),
  ];
}

// The bodies file for a briefing. Every tiered item gets an entry, including the
// ones no body was ever obtained for: an entry with two empty strings and
// summaryOnly is what tells a reader "this source only ever had a summary"
// apart from "the text has not arrived yet", which is the fingerprint's answer.
export function buildPublishedBodies(
  b: Briefing,
  articles: Record<string, CachedArticle>,
  items: InfoItem[],
): PublishedBodies {
  const byId = new Map(items.map((it) => [it.id, it]));
  const bodies: Record<string, PublishedBody> = {};
  for (const id of tieredItemIds(b)) {
    if (bodies[id]) continue;
    const cached = articles[id];
    const html = cached?.contentHtml ? stripDataImages(cached.contentHtml) : "";
    const text = cached?.textContent ?? "";
    // Unknown provenance is treated as evidence-incomplete, the same way
    // resolveSummaryOnly does: nothing later may quote a summary as the article.
    const item = byId.get(id);
    const summaryOnly = item ? (item.summaryOnly ?? !text) : true;
    bodies[id] = { text, html, summaryOnly };
  }
  return { date: b.date, generatedAt: b.generatedAt, bodies };
}

// Whether a bodies file belongs to a briefing. Both halves are replaced whole
// and reconciled per file, so a reader can hold a new briefing and the previous
// bodies for one sync interval; that is the case this answers.
export function bodiesMatch(
  b: Briefing | null,
  bodies: Pick<PublishedBodies, "date" | "generatedAt"> | null,
): boolean {
  if (!b || !bodies) return false;
  return bodies.date === b.date && bodies.generatedAt === b.generatedAt;
}

// --- files -----------------------------------------------------------------

async function readJson<T>(file: string): Promise<T | null> {
  try {
    if (!(await exists(file, { baseDir: BaseDirectory.AppData }))) return null;
    return JSON.parse(await readTextFile(file, { baseDir: BaseDirectory.AppData })) as T;
  } catch {
    return null;
  }
}

// Publish a briefing that has just landed on disk. Called after every
// saveBriefing — a run's and a re-triage's alike, since a re-triage moves items
// between the tiers and the bodies file is a function of who is in them.
//
// The briefing goes last. A reader that catches the pair mid-publish then has
// the older briefing with newer bodies, which its fingerprint check reads as
// "the text is on its way" — the harmless way round. The other order would show
// a new briefing over stale text without knowing it.
export async function publishBriefing(b: Briefing): Promise<void> {
  const [articles, items] = await Promise.all([
    loadArticles(b.date).catch(() => ({}) as Record<string, CachedArticle>),
    loadItems(b.date).catch(() => [] as InfoItem[]),
  ]);
  const bodies = buildPublishedBodies(b, articles, items);
  await writeTextAtomic(PUBLISHED_BODIES_FILE, JSON.stringify(bodies));
  await writeTextAtomic(PUBLISHED_BRIEFING_FILE, JSON.stringify(b, null, 2));
}

// The published briefing, or null when this device has never received one. No
// date check, deliberately (docs/36): the date is the collector's, and a reader
// opened at half past midnight or in another timezone should see the latest
// briefing labelled with the day it is for, not an empty screen.
export function loadPublishedBriefing(): Promise<Briefing | null> {
  return readJson<Briefing>(PUBLISHED_BRIEFING_FILE);
}

export function loadPublishedBodies(): Promise<PublishedBodies | null> {
  return readJson<PublishedBodies>(PUBLISHED_BODIES_FILE);
}
