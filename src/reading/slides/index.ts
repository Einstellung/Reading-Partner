// Public surface of the slides module (docs/14).

export type {
  AssembleStatus,
  AssetStatus,
  RunStatus,
  SlideKind,
  SlideOutline,
  SlideRun,
  SlideStatus,
  SlidesInit,
  SlidesState,
  TalkEntry,
} from "./types";
export {
  SLIDES_VERSION,
  createSlidesState,
  hasPendingWork,
  hasUnrunSlides,
  normalizeSlidesOnLoad,
  upsertTalk,
} from "./types";
export {
  bookBlock,
  parseSlidePlan,
  planUserMessage,
  slidesPlanSystemPrompt,
  validateDeckPlan,
  SLIDES_PLAN_SYSTEM_PROMPT,
  type DeckPlan,
  type PlanBook,
  type PlanChapter,
} from "./plan";
export {
  applyTalkOutline,
  buildTalkOutline,
  citableWithOutline,
  entriesFor,
  outlinePlanSystemPrompt,
  outlinePlanUserMessage,
  readerPointsFor,
  SLIDES_OUTLINE_PLAN_SYSTEM_PROMPT,
  type OutlineCut,
  type OutlineEntry,
  type TalkOutline,
} from "./outline";
export { contentSystemPrompt, contentUserMessage, sanitizeFragment } from "./content";
export { estimateOverflow, overflowNotice, type OverflowEstimate } from "./overflow";
export { assembleDeck, slugify, type AssembledSlide } from "./template";
export {
  buildGenerationRequest,
  buildPollRequest,
  generateImage,
  parseTaskId,
  parseTaskState,
  pollDelayMs,
  resolveImageGenConfig,
  DEFAULT_IMAGE_API_BASE,
  DEFAULT_IMAGE_MODEL,
  type ImageGenConfig,
  type ImageGenDeps,
} from "./imageGen";
export {
  SlidesPipeline,
  type AssetOutcome,
  type ContentOutcome,
  type SlidesActivity,
  type SlidesDeps,
  type SlidesSnapshot,
} from "./pipeline";
export {
  getCurrentDeck,
  listDecks,
  listDeckStates,
  listDeckTalks,
  openDeck,
  readDeckOutline,
  startDeck,
  type DeckTalk,
} from "./live";
export { deckFile, loadTalks, SLIDES_DIR } from "./store";
