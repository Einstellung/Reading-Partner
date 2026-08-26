// A retell (docs/31): the object the second stage of reading produces — one pass
// over what was read, under a topic, with its own conversation and its own
// outline. Retell mode is the posture that fills it: the AI questions and the
// reader answers chapter by chapter, and the outline is the by-product. The object and the process that produces it are the same subject,
// so they live in one directory.

export {
  defaultRetellName,
  newRetell,
  newRetellId,
  normalizeRetell,
  PLAN_VERSION,
  RETELL_VERSION,
  type Mark,
  type NewRetellFields,
  type RetellChapter,
  type PlanDecision,
  type RetellPlan,
  type Skeleton,
  type SkeletonSource,
  type Retell,
  type RetellDecision,
  type RetellMaterial,
} from "./types";
export {
  bucketRetellMarks,
  combineChapters,
  combinedSource,
  slotAt,
  slotFor,
  toRetellPlan,
  toRetellDecision,
  upsertDecision,
  type CombinedChapters,
  type MaterialSkeleton,
  type RetellSlot,
} from "./outline";
export {
  defaultMaterialSelection,
  retellRows,
  retellSummary,
  type MaterialCandidate,
  type RetellRow,
} from "./list";
export {
  loadMaterial,
  loadMaterials,
  readMaterialBytes,
  type LoadedMaterial,
} from "./material";
export {
  deleteRetell,
  listAllRetells,
  listRetellsForTopic,
  loadRetell,
  recordRetellDecision,
  saveRetell,
  retellFile,
  retellIdOf,
  retellThreadKey,
  updateRetell,
} from "./store";
export {
  buildRetellTurn,
  type RetellTalkAccess,
  type RetellTurn,
  type RetellTurnInput,
  type RetellTurnMessage,
} from "./turn";
export { createRetell, retellCandidates } from "./candidates";
export type { ReadingCard, RetellDecisionCardData, TalkArrangementCardData } from "./cards";
export { bucketMarks, formatMarks } from "./marks";
export { formatOutline, formatPlan, nextChapter } from "./plan";
export {
  buildRetellSystemPrompt,
  MACRO_INSTRUCTIONS,
  RETELL_INSTRUCTIONS,
  RETELL_KICKOFF,
  RIB_INSTRUCTIONS,
  type RetellContext,
  type RetellNote,
} from "./prompt";
export { buildSkeleton, chapterOfPage, formatSkeleton, type SkeletonInput } from "./skeleton";
export { buildRetellTools, type RetellToolDeps } from "./tools";
