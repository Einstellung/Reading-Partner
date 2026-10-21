// A topic search (docs/info/88): what the reader is following, drafted with
// Lumen at the door and kept in info-topic-searches.json. The config is the
// whole of what the search knows about the topic; the concern statement only
// says the reader is following it (docs/soul/48), and nothing below goes into
// a statement.

import type { RunSource } from "./pace";

export const TOPIC_SEARCHES_VERSION = 1;

export type TopicSearchStatus = "active" | "stopped";

export interface TopicSubtopic {
  id: string;
  name: string;
  picked: boolean;
}

// One search the runs fan out. Drafted by the model and never shown to the
// reader: `x` and `arxiv` are written the way titles on each platform are,
// `ranking` is one question in plain words for the rerank.
export interface TopicQuery {
  id: string;
  // The subtopic id this query serves; null for one over the whole topic.
  subtopic: string | null;
  x: string;
  arxiv: string | null;
  ranking: string;
  weight: number;
}

// The reader's answer to a question asked while drafting or after a run, in
// their own words.
export interface TopicAnswer {
  asked: string;
  answer: string;
  at: number;
}

// A paper the reader said was on the mark, as the program found it.
export interface TopicSeed {
  // The link-identity key: "arxiv:<id>" or "doi:<doi>".
  key: string;
  // The title the lookup found, never the reader's wording.
  title: string;
  // The name the reader gave, word for word.
  said: string;
  at: number;
}

export interface TopicSearch {
  // "ts-" + 8 hex.
  id: string;
  name: string;
  // The concern statement that says the reader is following this.
  concernId: string | null;
  // One paragraph of scope, in the reader's words.
  scope: string;
  subtopics: TopicSubtopic[];
  want: string[];
  avoid: string[];
  // Judgements made out loud while drafting that the reader did not object to.
  judgments: string[];
  // Disambiguating words: a post mentioning any one of them is on the topic.
  anchors: string[];
  queries: TopicQuery[];
  answers: TopicAnswer[];
  status: TopicSearchStatus;
  // A study (docs/info/91): one brief, revised in conversation. No nightly
  // run and no nightly issue; the first delivery does not stop it. It stays
  // active until the reader ends it (end_study), which stops it the way
  // stop_topic_search does.
  once?: boolean;
  // The sources its runs read (91 来源开关). Absent: every source.
  sources?: RunSource[];
  // Papers the reader named while drafting and confirmed (91 起草与种子).
  seeds?: TopicSeed[];
  // Bumped on every write of the record.
  revision: number;
  createdAt: number;
  lastRunAt: number | null;
}
