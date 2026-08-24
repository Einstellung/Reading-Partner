// Retell mode (docs/31): the posture where the AI questions and the reader
// answers, and the by-product is the outline of the talk they are preparing. The
// conversation it runs in belongs to a talk (reading/talks); everything here is
// the assembly that conversation is made of, and none of it touches disk.

export type { ReadingCard, RetellDecisionCardData } from "./cards";
export { bucketMarks, formatMarks } from "./marks";
export { formatOutline, formatPlan, nextChapter } from "./plan";
export {
  buildRetellSystemPrompt,
  RETELL_INSTRUCTIONS,
  RETELL_KICKOFF,
  type RetellContext,
  type RetellNote,
} from "./prompt";
export { buildSkeleton, chapterOfPage, formatSkeleton, type SkeletonInput } from "./skeleton";
export { buildRetellTools, type RetellToolDeps } from "./tools";
export {
  RETELL_VERSION,
  type Mark,
  type RetellChapter,
  type RetellDecision,
  type RetellPlan,
  type Skeleton,
  type SkeletonSource,
} from "./types";
