// Whether this device still owes the migration anything, cheaply enough to ask
// on a tick.
//
// One judgement, two callers: whatever puts the migration in front of the reader
// and the nightly dream pass that stands down until it has run
// (memory/dream/live.ts). Both read the same rule out of
// memory/observations/legacy.ts, so neither can drift into offering a move the
// other thinks is done.
//
// The rule is the observation layout and nothing else, deliberately. A dry run
// would answer for all eight steps, but it reads every thread file, every
// observation body and the statement file to do it — a pass over the whole store
// — and the steps before this one are repairs to data the app reads fine either
// way. What must not happen twice is a night written against observations that
// are about to move, and that is exactly what this asks.

import { legacyObservationLayout } from "../memory/observations/legacy";
import type { MigrationFs } from "./types";

export function needsMigration(fs: MigrationFs): Promise<boolean> {
  return legacyObservationLayout(fs);
}
