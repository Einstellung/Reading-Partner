// The desk: what the reader has put in front of the AI (docs/61). One capability
// for the registration and the laying of it; the assembly that turns a laid desk
// into a call is src/soul.

export {
  deskKindRegistered,
  openDesk,
  registerDeskItemKind,
  registeredDeskKinds,
  type OpenedDesk,
} from "./registry";
export type {
  DeskEnv,
  DeskHistory,
  DeskItem,
  DeskItemKind,
  DeskMemory,
  DeskMessage,
  DeskPromptView,
  DeskRef,
} from "./types";
