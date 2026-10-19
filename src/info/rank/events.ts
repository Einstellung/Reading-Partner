// Candidates merged into events (docs/88 「打分」 step 6). Candidates whose
// `main` is the same thing — one canonical URL, one arXiv paper, one GitHub
// repo, one X post — are one event: the original is its body and the posts
// lead to it. An event scores its best member plus min(10, 3·(posts − 1)).
// Events are then clustered greedily, best first: an event joins the first
// cluster whose lead it resembles at 0.48 or more (hybrid similarity), else
// leads a cluster of its own. A cluster scores its lead.
//
// The greedy clustering is ported from last30days-skill (lib/cluster.py,
// cluster_candidates, without the MMR representatives and the entity pass).
// Portions Copyright (c) 2026 Matt Van Horn, under the MIT License; the full
// notice is in third-party-licenses.txt here.

import { normalizeArxivId } from "../sources/plugins/arxiv-client";
import { githubRepoOfUrl } from "../sources/plugins/github-site";
import { xPostOfUrl } from "../x/post";
import { canonicalizeUrl } from "./canonical-url";
import { paperKeyOfUrl, unwrapLink } from "./link-identity";
import { hybridSimilarity, prepareText, type PreparedText } from "./similarity";

export const CLUSTER_THRESHOLD = 0.48;
/** The most an event gains from the posts leading to it. */
export const POST_BONUS_CAP = 10;
export const POST_BONUS_STEP = 3;

/**
 * The key of the thing a URL names, a redirect wrapper unwrapped first:
 * "arxiv:2505.06708" (any version, abs or PDF or HTML, a mirror, its Hugging
 * Face page, its arXiv DOI), "doi:10.…" (a DOI link or a publisher page with
 * the DOI in its path), "openreview:…", "acl:…", "ieee:…" (link-identity.ts),
 * "github:owner/repo" (lowercased, any page of the repo), "x:1849…" (a post),
 * else "url:" + the canonical URL. Null for a URL that is not http(s).
 */
export function eventKeyOfUrl(raw: string): string | null {
  const url = unwrapLink(raw);
  const paper = paperKeyOfUrl(url);
  if (paper) return paper;
  const repo = githubRepoOfUrl(url);
  if (repo) return `github:${repo.owner}/${repo.repo}`.toLowerCase();
  const post = xPostOfUrl(url);
  if (post) return `x:${post.id}`;
  const canonical = canonicalizeUrl(url);
  return canonical ? `url:${canonical}` : null;
}

/**
 * A key as eventKeyOfUrl gives it today: a "url:" key a past result stored is
 * keyed again, so a page seen under an older spelling (http, `www.`, a DOI
 * page) is still the same thing; any other key as it is.
 */
export function currentEventKey(key: string): string {
  return key.startsWith("url:") ? (eventKeyOfUrl(key.slice(4)) ?? key) : key;
}

/** The key of an arXiv paper by id ("arXiv:2505.06708v2" -> "arxiv:2505.06708"). */
export function arxivEventKey(id: string): string | null {
  const normalized = normalizeArxivId(id);
  return normalized ? `arxiv:${normalized}` : null;
}

/** The key of an X post by status id. */
export function xEventKey(statusId: string): string {
  return `x:${statusId}`;
}

export interface EventMember {
  /** The candidate's own id (c1, c2…, or a status id). */
  id: string;
  /** A post leads to an event; anything else (a paper) is an original. */
  kind: "post" | "paper";
  /** The key of what this member's main content is (eventKeyOfUrl, arxivEventKey, xEventKey). */
  key: string;
  /** Final score, 0-100. */
  score: number;
  /** Title and opening text, for the similarity pass. */
  text: string;
}

export interface RankedEvent<M extends EventMember = EventMember> {
  key: string;
  /** Best first. */
  members: M[];
  posts: number;
  score: number;
  /** The text the event is compared by: its original's, else its best post's. */
  text: string;
}

export interface EventCluster<M extends EventMember = EventMember> {
  lead: RankedEvent<M>;
  /** Lead first, then the events that joined it, in the order they joined. */
  events: RankedEvent<M>[];
  score: number;
}

function byScore<T extends { score: number }>(a: T, b: T): number {
  return b.score - a.score;
}

/** Members grouped by key, scored, best first (ties keep first-seen order). */
export function groupEvents<M extends EventMember>(members: readonly M[]): RankedEvent<M>[] {
  const groups = new Map<string, M[]>();
  for (const m of members) {
    const g = groups.get(m.key);
    if (g) g.push(m);
    else groups.set(m.key, [m]);
  }
  const events: RankedEvent<M>[] = [];
  for (const [key, group] of groups) {
    const sorted = [...group].sort(byScore);
    const posts = sorted.filter((m) => m.kind === "post").length;
    const bonus = Math.min(POST_BONUS_CAP, POST_BONUS_STEP * Math.max(0, posts - 1));
    const original = sorted.find((m) => m.kind !== "post");
    events.push({ key, members: sorted, posts, score: sorted[0].score + bonus, text: (original ?? sorted[0]).text });
  }
  return events.sort(byScore);
}

/** Greedy clustering of events, best first; clusters best first. */
export function clusterEvents<M extends EventMember>(
  events: readonly RankedEvent<M>[],
  threshold: number = CLUSTER_THRESHOLD,
): EventCluster<M>[] {
  const ordered = [...events].sort(byScore);
  const clusters: { cluster: EventCluster<M>; prepared: PreparedText }[] = [];
  for (const event of ordered) {
    const prepared = prepareText(event.text);
    const home = clusters.find((c) => hybridSimilarity(prepared, c.prepared) >= threshold);
    if (home) home.cluster.events.push(event);
    else clusters.push({ cluster: { lead: event, events: [event], score: event.score }, prepared });
  }
  return clusters.map((c) => c.cluster);
}

/** Members to events to clusters, in one call. */
export function mergeIntoEvents<M extends EventMember>(
  members: readonly M[],
  threshold: number = CLUSTER_THRESHOLD,
): EventCluster<M>[] {
  return clusterEvents(groupEvents(members), threshold);
}
