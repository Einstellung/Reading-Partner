// AI writes through the housekeeper (docs/platform/687): the registry domains
// put their writable kinds in, the edit_data and undo_edit tools, and the
// confirmation card. Not re-exported from the housekeeper's root: legion
// imports the root for its garbage markers and must not reach codemode by it.

export {
  dataPath,
  editableRows,
  registeredWritables,
  registerWritable,
  writableEntry,
  writeGuardProblems,
  type ComputedField,
  type Gate,
  type Initiator,
  type Landed,
  type Parsed,
  type Problem,
  type WritableEntry,
  type WriteContext,
} from "./registry";
export { changedPaths, underPattern } from "./paths";
export {
  appWriteIo,
  pendingOfRun,
  textBase,
  versionPath,
  pendingPath,
  type PendingRecord,
  type VersionRecord,
  type WriteIo,
} from "./store";
export {
  confirmPending,
  declinePending,
  liveWriteDeps,
  pendingWaits,
  settleEdit,
  undoLatest,
  type WriteDeps,
  type WriteOutcome,
  type UndoOutcome,
} from "./engine";
export { confirmCard, HOUSEKEEPER_CONFIRM_KIND, type HousekeeperConfirmCard, type RaiseConfirmCard } from "./card";
export {
  buildEditTools,
  EDIT_DATA_DESCRIPTION,
  EDIT_DATA_TOOL,
  UNDO_EDIT_DESCRIPTION,
  UNDO_EDIT_TOOL,
  withEditData,
  type EditSurface,
  type EditToolDeps,
} from "./tool";
