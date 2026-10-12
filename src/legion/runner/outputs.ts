// Where a run's product is kept (docs/55, docs/68).
//
// One directory for every kind: a run points at a path, never at the text, so
// the record stays a set of references whatever the worker produced. Machine-
// local, like the `local` runs that write here — palace registers it as
// `run-output`.

import { appData } from "../../platform/app/appdata";

/** Where a run's output is kept. Registered in palace/kinds.ts. */
export const OUTPUTS_DIR = "legion/outputs";

/** Write one run's output and answer with the path the run carries. */
export async function writeRunOutput(runId: string, text: string): Promise<string> {
  const path = `${OUTPUTS_DIR}/${runId}.md`;
  await appData.mkdirp(OUTPUTS_DIR);
  await appData.writeAtomic(path, text);
  return path;
}
