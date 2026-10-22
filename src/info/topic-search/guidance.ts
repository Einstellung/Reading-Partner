// The drafting rules and the roster, for the door turn's system prompt
// (docs/info/88 起草：来回问). Pure: the caller reads the searches, the
// statements and the topics and hands them in.
//
// The door prints the reader's profile already (soul/self.ts); concerns are
// printed here, with ids, because drafting is the one place at the door that
// has to point at one. Lapsed concerns are left out except where a stopped
// search hangs on one, so following it again can find it.

import type { Statement } from "../../memory";
import { ALL_SOURCES, sourceNames, sourcesOfPace, SPLIT_FIRST_LOOK, topicSources } from "./pace";
import { X_READ_RULE } from "./retry";
import type { TopicSearch } from "./types";

const SCOPE_CHARS = 160;

/** How a first look arrives (pace.ts), said the same way by the guidance and the confirm tool; "" when it is not split. */
export const FIRST_LOOK_IN_TWO_PARTS = SPLIT_FIRST_LOOK
  ? `A first look comes in two parts: what the fast sources (${sourceNames(sourcesOfPace("fast"))}) find is built and delivered ` +
    `first, as a brief issue of its own; ${sourceNames(sourcesOfPace("slow"))} is read slowly, the way a person browses (often ` +
    "an hour or more), and what it finds follows as a second issue. More social media may be added as sources later, and " +
    "they will be slow too. Never promise when the second part will come."
  : "";

function line(s: string): string {
  const first = s.trim().split("\n")[0]?.trim() ?? "";
  return first.length > SCOPE_CHARS ? `${first.slice(0, SCOPE_CHARS - 1)}…` : first;
}

export interface GuidanceInput {
  searches: readonly TopicSearch[];
  statements: readonly Statement[];
  /** Why X is not read on this device tonight (runs-live.ts xReadingPaused), or null. */
  xPaused?: string | null;
}

export function topicSearchGuidance({ searches, statements, xPaused = null }: GuidanceInput): string {
  const stoppedConcerns = new Set(
    searches.filter((s) => s.status === "stopped" && s.concernId).map((s) => s.concernId as string),
  );
  const concerns = statements.filter(
    (s) => s.kind === "concern" && !s.supersededBy && s.text.trim() !== "" && (!s.lapsed || stoppedConcerns.has(s.id)),
  );
  const roster = searches.map((s) => {
    const reads = topicSources(s);
    const tags = [s.status, ...(s.once ? ["a study"] : []), ...(reads.length < ALL_SOURCES.length ? [`reads ${sourceNames(reads)}`] : [])];
    return `- ${s.name} (id: ${s.id}, ${tags.join(", ")}) — ${line(s.scope)}`;
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
    xPaused ? `X reading on this device: ${xPaused}.` : "",
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
      "- A query's arxiv words are ANDed: every word must be in the paper. Write 2 to 4 short",
      "  keywords, the most specific first (\"protein design diffusion\", not \"how diffusion models",
      "  design proteins\"); never a sentence, no two-letter words (\"AI\" is dropped). Within the",
      "  query counts, two short queries beat one long one.",
      "- Settle scope, subtopics, what they want and what they don't. Then propose. The card",
      "  files nothing until they apply it; if they correct it in words, propose again.",
      "- When they say yes to the card in words (\"ok\", \"好\", \"go ahead\"), call",
      "  confirm_topic_search: it does what the card's Follow button does.",
      "- When they want to look into it once, not follow it daily (\"just this once\", \"只看这一次\"),",
      "  propose with once: a study. One brief comes, you revise it together in conversation, and it",
      "  goes on until they end it; nothing runs nightly.",
      "- Judge whether the topic is academic (research papers are what it is about). For an academic",
      "  topic propose with academic: true and sources arxiv and huggingface, without x; the card says",
      "  X is not read, so they can correct it. Otherwise leave sources out: every source is read.",
      "- For a study of an academic topic, ask once whether they already have a paper or two they know",
      "  is on target. Look each name up with find_seed_paper, one call per name. Have them confirm each",
      "  candidate (the card's buttons or in words) and pass the keys they confirmed as seeds. Never",
      "  present a candidate as their paper before they confirm it, and say nothing about it beyond what",
      "  the card shows. When nothing is found, say so and ask for a link or the fuller title.",
      ...(FIRST_LOOK_IN_TWO_PARTS
        ? [`- ${FIRST_LOOK_IN_TWO_PARTS} Say so in a line when you propose a search that reads X and when its first run starts.`]
        : []),
      "- Name an existing concern above that says the same thing as existingConcern, and a stopped",
      "  search they want back as searchId.",
      "When they answer a question, write it where it holds: only for this topic, with",
      "update_topic_search; for them in general, whatever the topic (\"I only read English",
      "originals\"), with statement_write as a profile; both when it is both. Then say in one line",
      "where it went: \"Saved to this topic\" or \"Saved to your profile\", in their language.",
      "When they ask what a term means, answer, then write a known statement with statement_write",
      "(\"Not familiar with symbolic regression\"); when they say they already know one, write that",
      "(\"Familiar with symbolic regression\"), superseding the line it overturns. Briefs explain by these.",
      "When the reader talks a study's brief over (docs/info/91):",
      "- Answer questions about it from the original with the brief's reading tools, citing [p.N \"quote\"] and the",
      "  section numbers. Never change the brief or say anything was recorded while you talk.",
      "- When they say something worth recording for the study (what to leave out, how to read the topic, an item to",
      "  pin, demote or rewrite), say your understanding in one sentence, then call propose_study_lines with their own",
      "  words. Nothing is recorded until they confirm the lines on the card; never say it was noted before.",
      "- When the front page says a line found nothing after a second round, or was not searched again, say so as the",
      "  book does. You may offer to search that line again: they say what to try in words, you record it with",
      "  propose_study_lines and update the brief once they confirm, as above. Never say the line will be found.",
      "- When they tell you to go ahead in words (\"对，更新吧\", \"go ahead\"), call update_study_brief: it does what the",
      "  card's button does. Never update the brief on your own.",
      "- When they say the study is good as it is (\"可以了\", \"就这样\"), offer to move the brief into reading and end the",
      "  study: call end_study with the reading topic you would suggest. Only their press on that card ends it.",
      "When they say they no longer care about a topic search, call stop_topic_search.",
      "When X reading is paused and they say to read X again, call resume_x_reading.",
      X_READ_RULE,
      "When they ask to search again after signing in to X, or to redo a search's first look, call",
      "retry_topic_search_first_run: it reads again only what the first run missed. Say only what a",
      "tool told you; never promise when X will be read or a result will come.",
      "When they ask whether a search's first look, a retry or a night's run has started, come back or",
      "finished, call background_status (about: the search's name or id) first: it says the run's state,",
      "elapsed time, X, arXiv and Hugging Face progress, result and brief issue (for a first look, whether its first part",
      "is out and X is still being read). Conversation search is not a source for run state.",
    ].join("\n"),
  ]
    .filter((b) => b !== "")
    .join("\n\n");
}
