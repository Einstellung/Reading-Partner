// Live wiring of the statement store: the AppData file behind it, and the
// resolver that turns an observation id into the days that observation covers.
//
// The resolver walks the topics because statements are not scoped to one and
// observations are (memory/statements/store.ts). One read per topic for an id
// that is in the first one is the cost, which is the same shape peekThreads and
// the arrears sweep already pay; nothing calls this per turn.

import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { listTopics } from "../../platform/app/topics";
import { ObservationFileStore } from "../observations/store";
import {
  createStatementStore,
  type StatementIo,
  type StatementStore,
} from "../statements/store";
import type { DaySpan } from "../statements/dates";
import { observationFs } from "./live";

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
    for (const topic of await listTopics()) {
      const entry = await new ObservationFileStore(topic.id, observationFs).get(id);
      if (entry) return { first: entry.created, last: entry.updated };
    }
    return null;
  },
};

const store: StatementStore = createStatementStore(statementIo);

export const listStatements = store.listStatements;
export const getStatement = store.getStatement;
export const createStatement = store.createStatement;
export const addEvidence = store.addEvidence;
export const addContradiction = store.addContradiction;
export const supersede = store.supersede;
