// The soul (docs/61): the one person who sits at the desk. What it carries into
// every turn whatever the desk holds is self.ts; the assembly that puts that
// person and a laid desk together into one call is turn.ts.

export { assembleTurn, configuredModel, type AssembleInput, type AssembledTurn } from "./turn";
export { SOUL_LANE, soulHarness, startSoulSession } from "./harness";
export {
  OUTPUT_MAX,
  answerBell,
  renderBell,
  runSubstance,
  startBellWatch,
  type AnswerBellDeps,
  type BellTurn,
  type BellWatchDeps,
  type ReadAppText,
  type RunSubstance,
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
  originLabel,
  parseOrigin,
  registerDelivery,
  registerTurnDelivery,
  turnDeliverer,
  type Delivery,
  type DeliveredTurn,
  type DeliveryHold,
  type DeliveryInput,
  type DeliveryOpener,
  type TurnDeliverer,
  type TurnDelivery,
  type TurnDeliveryOutcome,
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
  openDoorThread,
  openDoorTurn,
  type DoorTurnInput,
} from "./door";
export {
  sendAtTheDoor,
  type DoorSendDeps,
  type DoorSendInput,
  type DoorSendOutcome,
} from "./door-chat";
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
