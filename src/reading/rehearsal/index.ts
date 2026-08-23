// Rehearsal mode (docs/31): the posture where the AI questions and the reader
// answers, and the by-product is the outline of the talk they are preparing. The
// conversation it runs in belongs to a talk (reading/talks); everything here is
// the assembly that conversation is made of, and none of it touches disk.

export type { ReadingCard, RehearsalDecisionCardData } from "./cards";
export { bucketMarks, formatMarks } from "./marks";
export { formatOutline, formatPlan, nextChapter } from "./plan";
export {
  buildRehearsalSystemPrompt,
  REHEARSAL_INSTRUCTIONS,
  REHEARSAL_KICKOFF,
  type RehearsalContext,
  type RehearsalNote,
} from "./prompt";
export { buildSkeleton, chapterOfPage, formatSkeleton, type SkeletonInput } from "./skeleton";
export { buildRehearsalTools, type RehearsalToolDeps } from "./tools";
export {
  REHEARSAL_VERSION,
  type Mark,
  type RehearsalChapter,
  type RehearsalDecision,
  type RehearsalPlan,
  type Skeleton,
  type SkeletonSource,
} from "./types";
