// Which generated decks belong to a topic, derived rather than stored.
//
// slides/talks.json is one global list and a TalkEntry carries `bookIds`, not a
// topic id (reading/slides/types.ts). A topic carries its files' content hashes,
// which are the same ids. So a talk is this topic's when the two sets intersect:
// at least one of the books it was generated from is in the topic. Deriving it
// keeps the talks file's write format alone, which the slides pipeline owns.
//
// A talk spanning two topics therefore shows up under both. That is the honest
// answer until "can a talk span topics" is decided (docs/31, "前提与缺口").

import type { Topic } from "../../../../platform/app/topics";
import type { TalkEntry } from "../../../../reading/slides";

// The book ids a topic can claim. A file added but never opened has no hash yet
// and can match nothing, so it is left out rather than matched on its path.
export function topicBookIds(topic: Topic): Set<string> {
  const ids = new Set<string>();
  for (const f of topic.files) if (f.hash) ids.add(f.hash);
  return ids;
}

// Newest first. A talk with no book ids at all belongs to no topic: there is
// nothing to intersect, and showing it everywhere would be worse than nowhere.
export function talksForTopic(talks: readonly TalkEntry[], topic: Topic): TalkEntry[] {
  const ids = topicBookIds(topic);
  if (ids.size === 0) return [];
  return talks
    .filter((t) => t.bookIds.some((id) => ids.has(id)))
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);
}

// How many books a talk draws on, for the line under its title. Deduplicated:
// the same id twice in one entry is one book.
export function talkBooksLabel(talk: TalkEntry): string {
  const count = new Set(talk.bookIds).size;
  return `${count} book${count === 1 ? "" : "s"}`;
}
