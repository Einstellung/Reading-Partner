// A topic search (docs/info/88): what the reader is following, drafted with
// Lumen at the door and kept in info-topic-searches.json. The config is the
// whole of what the search knows about the topic; the concern statement only
// says the reader is following it (docs/soul/48), and nothing below goes into
// a statement.

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
  // The reader wanted one look only: the first run's delivery stops the search
  // and lapses its concern (88 定下的细节).
  once?: boolean;
  // Bumped on every write of the record.
  revision: number;
  createdAt: number;
  lastRunAt: number | null;
}
