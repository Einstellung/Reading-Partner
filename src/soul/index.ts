// The soul (docs/61): the one person who sits at the desk. What it carries into
// every turn whatever the desk holds is self.ts; the assembly that puts that
// person and a laid desk together into one call is turn.ts.

export { assembleTurn, configuredModel, type AssembleInput, type AssembledTurn } from "./turn";
export { soulMemorySection, openSoul, type LoadedRole, type Soul } from "./self";
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
  registerDoorDistillSource,
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
  EMPTY_SEQUENCE,
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
