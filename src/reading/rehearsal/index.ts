// Rehearsal mode (docs/31): the third posture of the book-level conversation,
// where the AI questions and the reader answers, and the by-product is the
// outline of the talk they are preparing to give.

export type { ReadingCard, RehearsalDecisionCardData } from "./cards";
export {
  flagsOf,
  modeOf,
  pressMode,
  type ModeButton,
  type ModeFlags,
  type ReadingMode,
} from "./mode";
export { bucketMarks, formatMarks, markCounts } from "./marks";
export {
  createPlan,
  decisionFor,
  formatPlan,
  nextChapter,
  normalizePlan,
  upsertDecision,
} from "./plan";
export {
  buildRehearsalSystemPrompt,
  REHEARSAL_INSTRUCTIONS,
  REHEARSAL_KICKOFF,
  type RehearsalContext,
  type RehearsalNote,
} from "./prompt";
export { buildSkeleton, chapterOfPage, formatSkeleton, type SkeletonInput } from "./skeleton";
export { loadRehearsalPlan, recordDecision, rehearsalFile, saveRehearsalPlan } from "./store";
export { buildRehearsalTools, type RehearsalToolDeps } from "./tools";
export { useRehearsal, type RehearsalController, type RehearsalHost } from "./use-rehearsal";
export {
  REHEARSAL_VERSION,
  type Mark,
  type RehearsalChapter,
  type RehearsalDecision,
  type RehearsalPlan,
  type Skeleton,
  type SkeletonSource,
} from "./types";
