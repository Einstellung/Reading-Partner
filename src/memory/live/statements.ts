// Live wiring of the statement store: the AppData file behind it, and the
// resolver that turns an observation id into the days that observation covers.
//
// One store read by id. A statement's evidence names observations across every
// topic (memory/statements/store.ts) and the observation store is one flat
// directory (memory/observations/store.ts), so an id is a file name and nothing
// has to be walked to find it.

import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { ObservationFileStore } from "../observations/store";
import {
  createStatementStore,
  type StatementIo,
  type StatementStore,
} from "../statements/store";
import type { DaySpan } from "../statements/dates";
import { observationFs } from "./fs";

// Unlike observationFs, a read that throws is not treated as a missing file.
// That store writes one file per observation and a lost read costs one entry;
// this one holds every statement in a single file, so answering null for a file
// that is there and would not open turns the next write into a truncation. The
// exists() probe is what keeps the two apart — a cost this path can afford,
// which the per-entry reads could not.
export const statementIo: StatementIo = {
  async read(path) {
    if (!(await appData.exists(path))) return null;
    return await appData.readText(path);
  },
  write(path, content) {
    return writeTextAtomic(path, content);
  },
  async observationDates(id): Promise<DaySpan | null> {
    const entry = await new ObservationFileStore(observationFs).get(id);
    return entry ? { first: entry.created, last: entry.updated } : null;
  },
};

const store: StatementStore = createStatementStore(statementIo);

// The store itself, for a caller that hands it on rather than calls it — the
// statement tool takes one (statements/tools.ts).
export const statementStore = store;

export const listStatements = store.listStatements;
export const getStatement = store.getStatement;
export const createStatement = store.createStatement;
export const addEvidence = store.addEvidence;
export const addContradiction = store.addContradiction;
export const supersede = store.supersede;
export const markSuperseded = store.markSuperseded;
