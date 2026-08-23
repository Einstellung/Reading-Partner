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
export {
  defaultTalkName,
  newTalk,
  newTalkId,
  normalizeTalk,
  TALK_VERSION,
  type NewTalkFields,
  type Talk,
  type TalkDecision,
  type TalkMaterial,
} from "./types";
export { createTalk, talkCandidates } from "./candidates";
