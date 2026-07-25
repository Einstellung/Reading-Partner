// Public surface of the slides module (docs/14).

export type {
  RunStatus,
  SlideKind,
  SlideOutline,
  SlideRun,
  SlideStatus,
  SlidesState,
  TalkEntry,
} from "./types";
export { SLIDES_VERSION, addTalk } from "./types";
export {
  parseSlidePlan,
  planUserMessage,
  SLIDES_PLAN_SYSTEM_PROMPT,
  type DeckPlan,
  type PlanBook,
} from "./plan";
export { contentSystemPrompt, contentUserMessage, sanitizeFragment } from "./content";
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
  type SlidesActivity,
  type SlidesDeps,
  type SlidesSnapshot,
} from "./pipeline";
export {
  getCurrentTalk,
  listBooksWithNotes,
  listTalks,
  startTalk,
  type BookWithNotes,
} from "./live";
export { deckFile, loadTalks, SLIDES_DIR } from "./store";
