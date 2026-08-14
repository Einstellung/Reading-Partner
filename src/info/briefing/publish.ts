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

import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { APPDATA, readJson, writeTextAtomic } from "../../platform/app/atomic-fs";
import { stripDataImages } from "../extract/sanitize";
import { loadArticles, loadItems, loadLatestBriefing, type CachedArticle } from "./store";
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

// Which briefing a published file belongs to: the day it is for, and which
// generation of that day. The pair, not either half, is what a reader trusts,
// and generatedAt alone is what says which of two briefings is the later one.
export type BriefingStamp = Pick<Briefing, "date" | "generatedAt">;

export interface PublishedBodies extends BriefingStamp {
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
export function bodiesMatch(b: BriefingStamp | null, bodies: BriefingStamp | null): boolean {
  if (!b || !bodies) return false;
  return bodies.date === b.date && bodies.generatedAt === b.generatedAt;
}

// --- the backfill (docs/36) -------------------------------------------------
//
// Publishing hangs off saveBriefing, so a briefing that landed before this
// machine could publish is never published at all: an upgrade from a version
// with no publishing in it, or a publish that failed, leaves a briefing sitting
// on the collector's disk while every reader shows nothing and explains nothing.
// A collector therefore asks this once, when it takes the claim.

export type BackfillVerdict = "nothing-local" | "published-newer" | "up-to-date" | "publish";

// What a startup backfill should do, given the newest briefing this machine
// holds and what is already at the two published names.
//
// A null published stamp has to mean the file is not there. "Could not read it"
// is a third answer and it belongs to the caller: read it as absent and this
// machine publishes its own older briefing over a newer one it merely failed to
// open, which is the one way a backfill makes things worse (backfillPublish
// refuses to write in that case).
//
// generatedAt is the whole ordering, and the date is not part of it: the date is
// the collector's label for the day, and a reader shows the latest briefing with
// the day it is for on it rather than an empty screen (docs/36). So yesterday's
// briefing is published when nothing newer exists — having one is better than
// having none — and another collector's newer briefing is never overwritten by
// this machine's older one, which is the one way a backfill could make things
// worse than leaving them alone.
//
// The bodies are in the comparison so that a half-published pair repairs itself:
// a briefing whose bodies never landed leaves a reader waiting for text that is
// not coming, and the fingerprint is what says so.
export function backfillVerdict(
  local: BriefingStamp | null,
  published: BriefingStamp | null,
  publishedBodies: BriefingStamp | null,
): BackfillVerdict {
  if (!local) return "nothing-local";
  if (!published) return "publish";
  if (local.generatedAt < published.generatedAt) return "published-newer";
  // The same briefing is already out, bodies and all. This has to be zero
  // writes: every one of them is an upload and a revision on the remote, and a
  // restart is not news.
  if (
    local.generatedAt === published.generatedAt &&
    local.date === published.date &&
    bodiesMatch(published, publishedBodies)
  ) {
    return "up-to-date";
  }
  return "publish";
}

// Whether the bodies just rebuilt for a briefing really are its text. The day's
// files are pruned as a set once a run starts on a new day (store.ts), so a
// briefing that outlived its own article cache rebuilds into a full set of empty
// entries — which every reader renders as "this source only publishes
// summaries", a claim about the source made out of a missing file. Publishing
// neither half is the better answer: the readers keep whatever pair they have,
// and the next run publishes a whole one.
export function bodiesIntact(b: Briefing, items: InfoItem[], bodies: PublishedBodies): boolean {
  const known = new Set(items.map((it) => it.id));
  for (const id of tieredItemIds(b)) {
    // The day's item snapshot is what tells "only ever a summary" apart from
    // "the file is gone"; without it every entry takes the summary-only
    // fallback and no reader could tell the difference.
    if (!known.has(id)) return false;
    const body = bodies.bodies[id];
    if (!body) return false;
    // The snapshot says the article itself was read, and yet there is no text:
    // the article cache went and the item snapshot stayed.
    if (!body.summaryOnly && !body.text && !body.html) return false;
  }
  return true;
}

// --- files -----------------------------------------------------------------

// Publish a briefing that has just landed on disk. Called after every
// saveBriefing — a run's and a re-triage's alike, since a re-triage moves items
// between the tiers and the bodies file is a function of who is in them.
//
// The briefing goes last. A reader that catches the pair mid-publish then has
// the older briefing with newer bodies, which its fingerprint check reads as
// "the text is on its way" — the harmless way round. The other order would show
// a new briefing over stale text without knowing it.
//
// The same intactness check the backfill runs, for the same reason: a re-triage
// on a day whose article cache has already been pruned rebuilds a full set of
// empty bodies, and publishing those tells every reader that each of those
// sources only ever publishes summaries. Neither half goes out then — the
// readers keep the pair they have, and the next run publishes a whole one.
export async function publishBriefing(b: Briefing): Promise<PublishOutcome> {
  const { bodies, items } = await rebuildBodies(b);
  if (!bodiesIntact(b, items, bodies)) return "no-bodies";
  await writePublished(b, bodies);
  return "published";
}

export type PublishOutcome = "published" | "no-bodies";

// The bodies for a briefing, out of the day's files. The item snapshot comes
// back too, because whoever is not publishing the briefing it just wrote has to
// be able to ask whether those files were still there (bodiesIntact).
async function rebuildBodies(
  b: Briefing,
): Promise<{ bodies: PublishedBodies; items: InfoItem[] }> {
  const [articles, items] = await Promise.all([
    loadArticles(b.date).catch(() => ({}) as Record<string, CachedArticle>),
    loadItems(b.date).catch(() => [] as InfoItem[]),
  ]);
  return { bodies: buildPublishedBodies(b, articles, items), items };
}

async function writePublished(b: Briefing, bodies: PublishedBodies): Promise<void> {
  await writeTextAtomic(PUBLISHED_BODIES_FILE, JSON.stringify(bodies));
  await writeTextAtomic(PUBLISHED_BRIEFING_FILE, JSON.stringify(b, null, 2));
}

// What a backfill did. "published" is the whole point of it; the rest are the
// reasons it is a no-op, which is what a healthy restart looks like.
export type BackfillOutcome =
  | Exclude<BackfillVerdict, "publish">
  | "no-bodies"
  | "unreadable-published"
  | "published";

// A published stamp, and whether this machine may write over that name. Three
// answers, not two:
//
//   nothing there, or bytes that will not parse into a stamp — no stamp, and
//   the name is free. Republishing is the whole repair.
//   a read that did not happen — no stamp either, and the name is NOT free.
//   Nothing is known to be wrong with those bytes, and publishing over them is
//   this machine's older briefing replacing a newer one it merely failed to
//   open. Costs one restart; the next launch reads the file again.
//
// The same split readGuardedJson makes, minus its quarantine. Quarantine is for
// files holding what the reader wrote and nothing can rebuild — the shelf, the
// notes, the credentials: moving the bad bytes aside is what keeps the empty
// fallback the caller saves next from becoming the only copy, and the reader is
// told where the old one went. These two names are a copy of a briefing the
// collector still has, replaced whole every run, and what they need is to hold
// something — a reader has no other source for the day, and a stale briefing is
// a screen where an absent one is nothing. Quarantining can leave the name empty
// and keep it empty: set an unparseable briefing aside, hit a bodies file that
// will not open, and the republish below is refused with nothing at that name
// until the bodies open again.
async function readPublishedStamp<T extends BriefingStamp>(
  file: string,
  validate: (raw: unknown) => T | null,
): Promise<{ stamp: T | null; writable: boolean }> {
  let text: string;
  try {
    if (!(await exists(file, APPDATA))) return { stamp: null, writable: true };
    text = await readTextFile(file, APPDATA);
  } catch (e) {
    console.warn(`failed to read ${file}`, e);
    return { stamp: null, writable: false };
  }
  try {
    return { stamp: validate(JSON.parse(text) as unknown), writable: true };
  } catch (e) {
    console.warn(`failed to parse ${file}`, e);
    return { stamp: null, writable: true };
  }
}

function isStamp(raw: unknown): BriefingStamp | null {
  const s = raw as Partial<BriefingStamp> | null;
  if (!s || typeof s !== "object") return null;
  if (typeof s.date !== "string" || typeof s.generatedAt !== "number") return null;
  return { date: s.date, generatedAt: s.generatedAt };
}

// Publish the briefing this machine already has, if the readers never got it.
// The day's heavy files are only opened once the stamps say something is going
// out, so the ordinary restart costs a directory listing and three small reads
// and writes nothing.
//
// The two questions this cannot answer are the caller's (live.ts): that this
// device collects at all, and that it is the elected collector. A reader has no
// local briefing and no business writing to the published names, and a desktop
// that lost the election must not put its own older briefing over the winner's.
export async function backfillPublish(): Promise<BackfillOutcome> {
  const [local, published, publishedBodies] = await Promise.all([
    loadLatestBriefing().catch(() => null),
    readPublishedStamp(PUBLISHED_BRIEFING_FILE, isStamp),
    readPublishedStamp(PUBLISHED_BODIES_FILE, isStamp),
  ]);
  if (!local) return "nothing-local";
  // One of the two names holds bytes this machine could not read. Nothing is
  // known to be wrong with them, so they are left exactly as they are and the
  // next launch reads them again.
  if (!published.writable || !publishedBodies.writable) return "unreadable-published";
  const verdict = backfillVerdict(local, published.stamp, publishedBodies.stamp);
  if (verdict !== "publish") return verdict;
  const { bodies, items } = await rebuildBodies(local);
  if (!bodiesIntact(local, items, bodies)) return "no-bodies";
  await writePublished(local, bodies);
  return "published";
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
