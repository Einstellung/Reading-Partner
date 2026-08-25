// The outline of a talk (docs/44): the spine that holds for the whole of it and
// the ordered segments it is given in. A retell produces one, a rehearsal is
// given against one, and it belongs to neither of them — which is why it is a
// directory of its own that imports neither.

export type { TalkArrangementCardData } from "./cards";
export {
  moveSegment,
  newSegmentId,
  putSegment,
  removeSegment,
  renameTalkOutline,
  setSpine,
  type SegmentEdit,
} from "./edit";
export {
  deleteTalkOutline,
  editTalkOutline,
  listAllTalkOutlines,
  listTalkOutlinesForTopic,
  loadTalkOutline,
  reserveTalkOutlineId,
  saveTalkOutline,
  startTalkOutline,
  talkOutlineFile,
  talkOutlineForRetell,
  talkOutlineIdOf,
  talkOutlineOfRetell,
  talkThreadKey,
  type StartTalkOutlineInput,
} from "./store";
export {
  DEFAULT_SEGMENT_STATUS,
  emptySpine,
  newTalkOutline,
  newTalkOutlineId,
  normalizeSegment,
  normalizeSpine,
  normalizeTalkOutline,
  TALK_OUTLINE_VERSION,
  type NewTalkOutlineFields,
  type SegmentStatus,
  type TalkMaterial,
  type TalkOutline,
  type TalkSegment,
  type TalkSpine,
} from "./types";
export {
  buildArrangeTools,
  formatTalkOutline,
  materialLabel,
  segmentCard,
  segmentStatusLabel,
  toTalkMaterial,
  type ArrangeToolDeps,
} from "./tools";
