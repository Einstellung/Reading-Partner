// The soul (docs/61): the one person who sits at the desk. What it carries into
// every turn whatever the desk holds is self.ts; the assembly that puts that
// person and a laid desk together into one call is turn.ts.

export { assembleTurn, configuredModel, type AssembleInput, type AssembledTurn } from "./turn";
export { SOUL_LANE, soulHarness } from "./harness";
export {
  answerBell,
  renderBell,
  startBellWatch,
  type AnswerBellDeps,
  type BellTurn,
  type BellWatchDeps,
  type SendBellTurn,
} from "./bell";
export { BOX_COVER_CAP, soulMemorySection, openSoul, type LoadedRole, type Soul, type SoulExtras } from "./self";
export {
  BRIEFS_DIR,
  DELEGATE_DESCRIPTION,
  DELEGATE_TOOL,
  buildDelegateTools,
  writeBriefFile,
  type DelegateDeps,
} from "./delegate";
export {
  deliveryOpener,
  liveDeliverer,
  originLabel,
  parseOrigin,
  registerDelivery,
  registerLiveDelivery,
  type Delivery,
  type DeliveredTurn,
  type DeliveryHold,
  type DeliveryInput,
  type DeliveryOpener,
  type LiveDelivery,
  type LiveDeliverer,
} from "./delivery";
export {
  listRoles,
  registerRole,
  roleOf,
  roleRegistered,
  type Role,
  type RoleWrite,
  type WriteGate,
} from "./roles";
export {
  DOOR_KIND,
  doorDate,
  doorKey,
  doorLabel,
  listDoorUnits,
  openDoorTurn,
  type DoorTurnInput,
} from "./door";
export { GO_TO_TOOL, buildPlaceTools, placesDescription } from "./places";
export {
  LIST_CAP,
  appCatalogueIo,
  buildCatalogueTools,
  forgetCatalogue,
  readCatalogue,
  shownRows,
  type Catalogue,
  type CatalogueEntry,
  type CatalogueIo,
  type CatalogueKind,
} from "./catalogue";
export {
  SEQUENCE_FILE,
  SEQUENCE_VERSION,
  appSequenceIo,
  currentStamp,
  deskOfFile,
  isStale,
  orderSpans,
  readSequence,
  rebuildSequence,
  spanOf,
  type ConversationSpan,
  type DeskOf,
  type Sequence,
  type SequenceIo,
  type SpanKind,
  type Stamp,
} from "./sequence";
export {
  TAIL_RUNG,
  TAIL_RUNG_ID,
  TURN_KEEP,
  assembleTail,
  bookTitles,
  deskLabel,
  soulTail,
  type TailInput,
  type TailMessage,
  type TailSpan,
} from "./tail";
