// Child process of one-thread-kill.test.ts: start a coach or retell turn on the
// device runtime over the app's thread store, and print ARMED once 200
// characters of the answer are on the live view, for the parent to SIGKILL it.
// Usage: bun one-thread-kill-child.ts <root> <coach|retell>

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { TURN_SECTION } from "../../../src/legion/durable/device";
import { storeThreadFiles } from "../../../src/legion/durable/thread-files";
import { startTurn, textOf } from "../../../src/legion/durable/turn";
import { openReadingDurable } from "../../../src/reading/turn/durable-runtime";
import { testHost } from "../../legion/durable/support/runtime";
import { fileThreadStore, slowFauxModels } from "./support/file-threads";
import { KILL_CASES, KILL_REPLY } from "./support/one-thread-file";

const root = process.argv[2]!;
const c = KILL_CASES[process.argv[3] as keyof typeof KILL_CASES];
const durable = await openReadingDurable({
  catalog: [],
  host: testHost(root),
  models: slowFauxModels([KILL_REPLY], 70).models,
  threads: storeThreadFiles(fileThreadStore(root)),
  openDesk: async () => [],
  places: { [c.place]: c.factory() },
  log: () => {},
});
const turn = await startTurn(
  durable.runtime,
  {
    key: c.key,
    origin: c.origin,
    content: c.line.text,
    sections: { [TURN_SECTION]: "You are the coach." },
    tools: [],
    model: { provider: "faux", modelId: "faux-1" },
    ...(c.line.ts !== undefined ? { excludeTs: c.line.ts } : {}),
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
