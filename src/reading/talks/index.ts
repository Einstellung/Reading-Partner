// A talk (docs/31): the object the second stage of reading produces — one
// preparation of one talk, under a topic, with its own conversation, its own
// outline and, at the end, its deck.

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
  talkProgress,
  toRehearsalPlan,
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
  toAnnotationLite,
  type LoadedMaterial,
} from "./material";
export {
  deleteTalk,
  listAllTalks,
  listTalksForTopic,
  loadTalk,
  recordTalkDecision,
  saveTalk,
  startTalk,
  talkFile,
  talkIdOf,
  talkThreadKey,
  updateTalk,
  type NewTalkInput,
} from "./store";
export {
  buildTalkTurn,
  HISTORY_KEEP,
  HISTORY_KEEP_TIGHT,
  type TalkTurn,
  type TalkTurnInput,
  type TalkTurnMessage,
} from "./turn";
export {
  createTalk,
  defaultTalkName,
  newTalkId,
  normalizeTalk,
  TALK_VERSION,
  type CreateTalkInput,
  type Talk,
  type TalkDecision,
  type TalkMaterial,
} from "./types";
