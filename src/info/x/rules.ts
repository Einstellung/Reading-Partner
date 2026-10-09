// The rule-based fan-out of an X post (docs/84 「实现」), still what the app
// runs until the link agent passes its comparison (docs/86 「第一期」). It
// turns a read post into what to build and what to follow: the kinds of thing a
// post recommends are followed, up to MAX_FOLLOW; a post that leads somewhere is
// a lead and not a document; an Article's own links are not followed.
//
// Goes with reading/ingest/x-post.ts when the switch is made.

import type { Rejection } from "../../workshop/bindery";
import { classifyOutbound, type HintKind } from "../links/hints";
import { readPost, type XOwnDocument, type XPostRecord, type XReadDeps, type XSkip } from "./read-post";

/** A link out of a post to hand the bindery's registry. */
export interface XTarget {
  url: string;
  kind: string;
  /** The post it came out of. */
  postId: string;
}

export interface XReading {
  ok: true;
  record: XPostRecord;
  documents: XOwnDocument[];
  follow: XTarget[];
  skipped: XSkip[];
}

/** Links followed out of one pasted post, the quoted one's included. */
export const MAX_FOLLOW = 6;

const FOLLOWED = new Set<HintKind>(["site", "drive", "pdf", "github", "page"]);

/** Read the post a link is about and decide, by rule, what to build and follow. */
export async function readXPost(url: string, deps: XReadDeps): Promise<XReading | Rejection> {
  const read = await readPost(url, deps);
  if (!read.ok) return read;
  const skipped = [...read.skipped];
  const follow: XTarget[] = [];
  for (const link of read.links) {
    // An Article's links are its references, not what it is about (docs/84 外链实测 6).
    if (link.origin === "article") continue;
    const hint = classifyOutbound(link.url, (u) => (deps.claimedBySite(u) ? "site" : null));
    if (!FOLLOWED.has(hint.kind)) {
      skipped.push({ subject: link.url, reason: hint.reason ?? hint.label });
      continue;
    }
    if (follow.length >= MAX_FOLLOW) {
      skipped.push({ subject: link.url, reason: `past the first ${MAX_FOLLOW} links` });
      continue;
    }
    follow.push({ url: link.url, kind: hint.kind, postId: link.postId });
  }
  // A post that leads somewhere is a lead however long it is (docs/84 要什么):
  // what it points at is the document, its own words stay in the record. An
  // Article is content in its own right.
  const leads = new Set(follow.map((t) => t.postId));
  const documents = read.own.filter((d) => d.shape === "article" || !leads.has(d.postId));
  return { ok: true, record: read.record, documents, follow, skipped };
}
