// Child process of meals-kill.test.ts: start a turn in the meals
// conversation on the device runtime over the app's thread store, and print
// ARMED once 200 characters of the answer are stored, for the parent
// to SIGKILL it.
// Usage: bun meals-kill-child.ts <root>

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { TURN_SECTION } from "../../../src/legion/durable/device";
import { storeThreadFiles } from "../../../src/legion/durable/thread-files";
import { startTurn } from "../../../src/legion/durable/turn";
import { openReadingDurable } from "../../../src/reading/turn/durable-runtime";
import { MEALS_CONVERSATION_KEY, MEALS_ORIGIN, mealsPlace } from "../../../src/meals/conversation/durable";
import { testHost } from "../../legion/durable/support/runtime";
import { fileThreadStore, slowFauxModels } from "../../reading/turn/support/file-threads";
import { MEALS_ANSWER, MEALS_LINE } from "./support/meals-file";
import { whenStoredText } from "../../legion/durable/support/stored-text";

const root = process.argv[2]!;
const deps = { assembled: new Map(), openDesk: async () => [], watching: () => true, card: async () => {} };
const durable = await openReadingDurable({
  catalog: [],
  host: testHost(root),
  models: slowFauxModels([MEALS_ANSWER], 70).models,
  threads: storeThreadFiles(fileThreadStore(root)),
  openDesk: async () => [],
  places: { meals: mealsPlace(deps) },
  log: () => {},
});
const turn = await startTurn(
  durable.runtime,
  {
    key: MEALS_CONVERSATION_KEY,
    origin: MEALS_ORIGIN,
    content: MEALS_LINE.text,
    sections: { [TURN_SECTION]: "You are the secretary." },
    tools: [],
    model: { provider: "faux", modelId: "faux-1" },
    excludeTs: MEALS_LINE.ts,
  },
  ctx,
);
whenStoredText(durable.runtime.harness, turn.conversation.id, 200, () => process.stdout.write("ARMED\n"));
await new Promise<never>(() => {});
