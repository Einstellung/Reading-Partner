// Child process of info-kill.test.ts: start a turn in an info or meals
// conversation on the device runtime over the app's thread store, and print
// ARMED once 200 characters of the answer are on the live view, for the parent
// to SIGKILL it.
// Usage: bun info-kill-child.ts <root> <info|meals>

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { TURN_SECTION } from "../../../src/legion/durable/device";
import { storeThreadFiles } from "../../../src/legion/durable/thread-files";
import { startTurn, textOf } from "../../../src/legion/durable/turn";
import { openReadingDurable } from "../../../src/reading/turn/durable-runtime";
import { infoPlace, infoThreadKey, mealsPlace } from "../../../src/info/briefer/info-durable";
import { testHost } from "../../legion/durable/support/runtime";
import { fileThreadStore, slowFauxModels } from "../../reading/turn/support/file-threads";
import { INFO_ANSWER, INFO_LINE, KILL_ORIGINS } from "./support/info-file";

const root = process.argv[2]!;
const origin = KILL_ORIGINS[process.argv[3] as "info" | "meals"];
const deps = { assembled: new Map(), openDesk: async () => [], watching: () => true, card: async () => {} };
const durable = await openReadingDurable({
  catalog: [],
  host: testHost(root),
  models: slowFauxModels([INFO_ANSWER], 70).models,
  threads: storeThreadFiles(fileThreadStore(root)),
  openDesk: async () => [],
  places: { info: infoPlace(deps), meals: mealsPlace(deps) },
  log: () => {},
});
const turn = await startTurn(
  durable.runtime,
  {
    key: infoThreadKey(origin),
    origin,
    content: INFO_LINE.text,
    sections: { [TURN_SECTION]: "You are the secretary." },
    tools: [],
    model: { provider: "faux", modelId: "faux-1" },
    excludeTs: INFO_LINE.ts,
  },
  ctx,
);
let fired = false;
(await turn.conversation.viewState(ctx)).subscribe((value) => {
  const live = value.docs["pi.live"] as { generation?: { message?: unknown } } | undefined;
  if (!fired && textOf(live?.generation?.message).length >= 200) {
    fired = true;
    process.stdout.write("ARMED\n");
  }
});
await new Promise<never>(() => {});
