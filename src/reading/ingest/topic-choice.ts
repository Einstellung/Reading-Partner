// Which topic the intake card marks as Lumen's suggestion (topic-intake.ts).
//
// The program decides from what it has: a topic whose name appears in the link
// or in what the reader said about it, and otherwise the topic used most
// recently. A model that has seen the numbered list (topicMenu) may pick one by
// its number instead; it answers with the number and never with an id.
//
// Pure: the topics are handed in.

import type { Topic } from "../../platform/app/topics";

/** One row of the card's topic list. `index` is 1-based and is what a model names. */
export interface TopicChoice {
  index: number;
  id: string;
  name: string;
}

export interface TopicChoices {
  topics: TopicChoice[];
  /** The suggested topic's id; null when there are no topics. */
  suggested: string | null;
}

// Words too common to say anything about which topic a link belongs to.
const STOP = new Set(["the", "and", "for", "with", "from", "www", "com", "org", "net", "http", "https", "html"]);

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

// The link spelled as words: its address decoded, punctuation as spaces.
function linkText(url: string, note: string | undefined): string {
  let address = url;
  try {
    address = decodeURIComponent(url);
  } catch {
    // A malformed escape: the address as it is spelled.
  }
  return normalize(`${address} ${note ?? ""}`).replace(/[\s\p{P}\p{S}]+/gu, " ");
}

// Whether a piece of a name is in the link: Latin as whole words and at least
// `min` long, anything else (CJK has no spaces to split on) as a substring of
// two or more characters.
function contains(text: string, piece: string, min: number): boolean {
  if (/^[\p{Script=Latin}\d ]+$/u.test(piece)) return piece.length >= min && ` ${text} `.includes(` ${piece} `);
  return piece.length >= 2 && text.includes(piece);
}

// How strongly a topic's name matches the link: the length of the longest piece
// of the name found in it, 0 for none. The whole name counts, and so does each
// word of it that is not a stop word.
function nameScore(name: string, text: string): number {
  const whole = normalize(name).replace(/[\s\p{P}\p{S}]+/gu, " ").trim();
  if (!whole) return 0;
  let best = contains(text, whole, 2) ? whole.length : 0;
  for (const piece of whole.split(" ")) {
    if (!STOP.has(piece) && contains(text, piece, 3)) best = Math.max(best, piece.length);
  }
  return best;
}

/** When a topic was last used: its newest file opened or added, else when it was made. */
export function lastUsed(topic: Topic): number {
  let at = topic.createdAt;
  for (const f of topic.files) at = Math.max(at, f.lastOpenedAt ?? f.addedAt);
  return at;
}

/** The topic a name in the link points at, else the one used most recently. Null for no topics. */
export function suggestTopic(topics: readonly Topic[], url: string, note?: string): Topic | null {
  const text = linkText(url, note);
  let best: Topic | null = null;
  let bestScore = -1;
  for (const topic of topics) {
    const score = nameScore(topic.name, text);
    if (score > bestScore || (score === bestScore && best && lastUsed(topic) > lastUsed(best))) {
      best = topic;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The card's list, in the shelf's order and numbered from 1, with one marked.
 * `pick` is a model's 1-based choice from topicMenu; a number off the list is
 * ignored and the program's suggestion stands.
 */
export function topicChoicesOf(
  topics: readonly Topic[],
  link: { url: string; note?: string },
  pick?: number,
): TopicChoices {
  const rows = topics.map((t, i) => ({ index: i + 1, id: t.id, name: t.name }));
  const picked = pick !== undefined && Number.isInteger(pick) ? rows[pick - 1] : undefined;
  const suggested = picked?.id ?? suggestTopic(topics, link.url, link.note)?.id ?? null;
  return { topics: rows, suggested };
}

/** The numbered list a model is shown to pick from: one "N. name" line per topic. */
export function topicMenu(choices: TopicChoices): string {
  return choices.topics.map((t) => `${t.index}. ${t.name}`).join("\n");
}
