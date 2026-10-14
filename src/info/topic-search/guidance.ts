// The drafting rules and the roster, for the door turn's system prompt
// (docs/info/88 起草：来回问). Pure: the caller reads the searches, the
// statements and the topics and hands them in.
//
// The door prints the reader's profile already (soul/self.ts); concerns are
// printed here, with ids, because drafting is the one place at the door that
// has to point at one. Lapsed concerns are left out except where a stopped
// search hangs on one, so following it again can find it.

import type { Statement } from "../../memory";
import type { TopicSearch } from "./types";

const SCOPE_CHARS = 160;

function line(s: string): string {
  const first = s.trim().split("\n")[0]?.trim() ?? "";
  return first.length > SCOPE_CHARS ? `${first.slice(0, SCOPE_CHARS - 1)}…` : first;
}

export interface GuidanceInput {
  searches: readonly TopicSearch[];
  statements: readonly Statement[];
  topics: readonly { id: string; name: string }[];
}

export function topicSearchGuidance({ searches, statements, topics }: GuidanceInput): string {
  const stoppedConcerns = new Set(
    searches.filter((s) => s.status === "stopped" && s.concernId).map((s) => s.concernId as string),
  );
  const concerns = statements.filter(
    (s) => s.kind === "concern" && !s.supersededBy && s.text.trim() !== "" && (!s.lapsed || stoppedConcerns.has(s.id)),
  );
  const roster = searches.map((s) => {
    const topic = topics.find((tp) => tp.id === s.topicId)?.name ?? s.topicId;
    return `- ${s.name} (id: ${s.id}, ${s.status}, topic "${topic}") — ${line(s.scope)}`;
  });
  return [
    "TOPIC SEARCHES",
    roster.length ? ["The reader's topic searches:", ...roster].join("\n") : "The reader follows no topic search yet.",
    concerns.length
      ? [
          "What they are keeping an eye on (concerns, by id):",
          ...concerns.map((s) => `- ${s.text.trim()} (id ${s.id}, ${s.author}${s.lapsed ? ", lapsed" : ""})`),
        ].join("\n")
      : "",
    topics.length
      ? ["Their reading topics:", ...topics.map((tp) => `- ${tp.name} (id: ${tp.id})`)].join("\n")
      : "",
    [
      "When the reader says they follow something and want material on it, draft a topic search",
      "with them before calling propose_topic_search:",
      "- Understand them from what is written about them above (profile and concerns) only.",
      "  Do not guess past it: whatever you are unsure of, or would write down without",
      "  understanding what they meant, ask in the conversation.",
      "- A broad topic (\"AI for science\") is split into subtopics first (materials, proteins,",
      "  weather, proofs…) and the reader picks. web_search is there if you need to learn",
      "  what a field's subtopics are.",
      "- Say your judgements out loud so they can correct them (\"I'm counting AI-assisted chip",
      "  design as engineering, not science\").",
      "- Ask before drafting when their words fall into a keyword trap: shopping-for-a-crowd",
      "  phrasing, a number that collides with other things, tutorial wording, one generic noun,",
      "  or non-Latin script.",
      "- Settle scope, subtopics, what they want and what they don't. Then propose. The card",
      "  files nothing until they apply it; if they correct it in words, propose again.",
      "- Name an existing concern above that says the same thing as existingConcern, and a stopped",
      "  search they want back as searchId. File into an existing topic by id where one fits.",
      "When they answer a question, write it where it holds: only for this topic, with",
      "update_topic_search; for them in general, whatever the topic (\"I only read English",
      "originals\"), with statement_write as a profile; both when it is both. Then say in one line",
      "where it went: \"Saved to this topic\" or \"Saved to your profile\", in their language.",
      "When they say they no longer care about a topic search, call stop_topic_search.",
    ].join("\n"),
  ]
    .filter((b) => b !== "")
    .join("\n\n");
}
