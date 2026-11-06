// Child process of door-kill.test.ts: start a turn at the door on the device
// runtime over the app's thread store, and print ARMED once 200 characters of
// the answer are stored, for the parent to SIGKILL it. Its turn log
// goes to <root>/child-turn-log.jsonl.
// Usage: bun door-kill-child.ts <root>

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { TURN_SECTION } from "../../src/legion/durable/device";
import { storeThreadFiles } from "../../src/legion/durable/thread-files";
import { startTurn } from "../../src/legion/durable/turn";
import { openReadingDurable } from "../../src/reading/turn/durable-runtime";
import { doorPlace, doorThreadKey } from "../../src/soul/door-durable";
import { testHost } from "../legion/durable/support/runtime";
import { fileThreadStore, slowFauxModels } from "../reading/turn/support/file-threads";
import { DOOR, DOOR_ANSWER, DOOR_LINE } from "./support/door-file";
import { whenStoredText } from "../legion/durable/support/stored-text";

const root = process.argv[2]!;
const durable = await openReadingDurable({
  catalog: [],
  host: testHost(root),
  models: slowFauxModels([DOOR_ANSWER], 70).models,
  threads: storeThreadFiles(fileThreadStore(root)),
  openDesk: async () => [],
  places: { door: doorPlace({ assembled: new Map(), openDesk: async () => [], watching: () => true, card: async () => {} }) },
  log: (line) => appendFileSync(join(root, "child-turn-log.jsonl"), `${JSON.stringify(line)}\n`),
});
const turn = await startTurn(
  durable.runtime,
  {
    key: doorThreadKey(DOOR),
    origin: DOOR,
    content: DOOR_LINE.text,
    sections: { [TURN_SECTION]: "You are Kris." },
    tools: [],
    model: { provider: "faux", modelId: "faux-1" },
    excludeTs: DOOR_LINE.ts,
  },
  ctx,
);
whenStoredText(durable.runtime.harness, turn.conversation.id, 200, () => process.stdout.write("ARMED\n"));
await new Promise<never>(() => {});
