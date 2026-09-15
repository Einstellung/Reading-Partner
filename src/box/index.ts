// The Red Box: what a delivery put in front of the reader, one item per file
// (docs/60).
//
// Importing this registers the item file's merge with sync. The engine may not
// import box — platform is the floor — so the arrow goes this way, the same way
// legion/run registers its own join.

import { registerLattice } from "../platform/sync/merge/lattice";
import { joinBoxItemFiles } from "./merge";

registerLattice("box-item", joinBoxItemFiles);

export {
  BOX_ITEM_STATES,
  isBoxItemState,
  isExit,
  isOpen,
  type BoxItem,
  type BoxItemState,
  type BoxOrigin,
} from "./types";
export {
  asBoxItem,
  collided,
  compareBoxItem,
  joinBoxItemFiles,
  mergeBoxItem,
} from "./merge";
export {
  BOX_DIR,
  appBox,
  appBoxIo,
  createBoxStore,
  randomBoxItemId,
  type BoxFilter,
  type BoxIo,
  type BoxListener,
  type BoxStore,
  type PutBoxItemInput,
} from "./store";
