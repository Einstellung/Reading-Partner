// A topic's sections, minus React (docs/31, docs/43, docs/51): what they are and
// which one a topic opens on. They are a row of tabs under the topic's name now
// that the shell owns the left column (base/shell-nav.ts), so there is no width
// left to remember and nothing to collapse.

export type TopicSection = "materials" | "retell" | "rehearsal" | "observations";

// In the order the work happens: read the materials, go through them with the AI,
// give the result out loud. Rehearsal is not under Retell (docs/43): the talk
// being rehearsed is as often one the reader already had as one prepared here.
export const TOPIC_SECTIONS: readonly { id: TopicSection; label: string }[] = [
  { id: "materials", label: "Materials" },
  { id: "retell", label: "Retell" },
  { id: "rehearsal", label: "Rehearsal" },
  { id: "observations", label: "AI observations" },
];

export const DEFAULT_SECTION: TopicSection = "materials";
