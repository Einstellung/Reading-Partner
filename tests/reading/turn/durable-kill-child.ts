// Child process of durable-kill.test.ts: start a book turn on the reading
// runtime over the app's thread store, and print ARMED once 200 characters of
// the answer are on the live view, for the parent to SIGKILL it.
// Usage: bun durable-kill-child.ts <root>

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { startTurn, textOf } from "../../../src/legion/durable/turn";
import { bookThreadKey, bookThreadOrigin, storeBookThreads } from "../../../src/reading/turn/durable-book";
import { openReadingDurable } from "../../../src/reading/turn/durable-runtime";
import { testHost } from "../../legion/durable/support/runtime";
import { fileThreadStore, KILL_ANSWER, KILL_BOOK, KILL_LINE, slowFauxModels } from "./support/file-threads";

const root = process.argv[2]!;
const store = fileThreadStore(root);
const durable = await openReadingDurable({
  catalog: [],
  host: testHost(root),
  models: slowFauxModels([KILL_ANSWER], 70).models,
  threads: storeBookThreads(store),
  card: async () => {},
  openDesk: async () => [],
  log: () => {},
});
const turn = await startTurn(
  durable.runtime,
  {
    key: bookThreadKey(KILL_BOOK),
    origin: bookThreadOrigin(KILL_BOOK),
    content: KILL_LINE.text,
    sections: { turn: "You are a reading partner." },
    tools: [],
    model: { provider: "faux", modelId: "faux-1" },
    excludeTs: KILL_LINE.ts,
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
