// A talk (docs/31): the object the second stage of reading produces — one
// preparation of one talk, under a topic, with its own conversation, its own
// outline and, at the end, its deck. Retell mode is the posture that produces
// it: the AI questions and the reader answers, and the by-product is the
// outline. The object and the process that fills it are the same subject, so
// they live in one place.

export {
  defaultTalkName,
  newTalk,
  newTalkId,
  normalizeTalk,
  RETELL_VERSION,
  TALK_VERSION,
  type Mark,
  type NewTalkFields,
  type RetellChapter,
  type RetellDecision,
  type RetellPlan,
  type Skeleton,
  type SkeletonSource,
  type Talk,
  type TalkDecision,
  type TalkMaterial,
} from "./types";
export {
  bucketTalkMarks,
  combineChapters,
  combinedSource,
  moveDecision,
  outlineRows,
  removeDecision,
  setIncluded,
  slotAt,
  slotFor,
  toRetellPlan,
  toTalkDecision,
  upsertDecision,
  type CombinedChapters,
  type OutlineRow,
  type TalkSkeleton,
  type TalkSlot,
} from "./outline";
export {
  defaultMaterialSelection,
  talkRows,
  talkSummary,
  type MaterialCandidate,
  type TalkRow,
  type TalkStage,
} from "./list";
export {
  loadMaterial,
  loadMaterials,
  readMaterialBytes,
  type LoadedMaterial,
} from "./material";
export {
  deleteTalk,
  listAllTalks,
  listTalksForTopic,
  loadTalk,
  recordTalkDecision,
  saveTalk,
  talkFile,
  talkIdOf,
  talkThreadKey,
  updateTalk,
} from "./store";
export {
  buildTalkTurn,
  type TalkTurn,
  type TalkTurnInput,
  type TalkTurnMessage,
} from "./turn";
export { createTalk, talkCandidates } from "./candidates";
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
