// Child process of info-voice-kill.test.ts: a voice call's turn in the day's
// info conversation on the device runtime, over the app's thread store on a
// directory. The transcript writes the reader's spoken line, the turn streams,
// and ARMED is printed once 200 characters have gone to the synthesiser, for
// the parent to SIGKILL this process.
// Usage: bun info-voice-kill-child.ts <root>

import type { InfoCallAnchor } from "../../../src/info/briefer/anchors";
import { infoBookId } from "../../../src/info/briefer/call";
import { infoPlace, infoThreadKey } from "../../../src/info/briefer/info-durable";
import { storeThreadFiles } from "../../../src/legion/durable/thread-files";
import { openReadingDurable } from "../../../src/reading/turn/durable-runtime";
import { infoVoiceThread } from "../../../src/reading/turn/info-voice";
import { testHost } from "../../legion/durable/support/runtime";
import { fileThreadStore, slowFauxModels } from "./support/file-threads";
import { VOICE_ANSWER, VOICE_DATE, VOICE_LINE, VOICE_ORIGIN } from "./support/info-voice-file";

const root = process.argv[2]!;
const store = fileThreadStore(root);
const durable = await openReadingDurable({
  catalog: [],
  host: testHost(root),
  models: slowFauxModels([VOICE_ANSWER], 70).models,
  threads: storeThreadFiles(store),
  openDesk: async () => [],
  places: { info: infoPlace({ assembled: new Map(), openDesk: async () => [], watching: () => true, card: async () => {} }) },
  log: () => {},
});
const { model, transcript } = infoVoiceThread({
  bookId: infoBookId(VOICE_DATE),
  dateKey: VOICE_DATE,
  anchor: { threadId: VOICE_ORIGIN.threadId } as InfoCallAnchor,
  tools: async () => [],
  store,
  durable: () => Promise.resolve(durable),
  session: () => undefined,
  prepare: async () => ({
    kind: "turn",
    key: infoThreadKey(VOICE_ORIGIN),
    origin: VOICE_ORIGIN,
    items: [],
    systemPrompt: "You are the secretary.",
    line: VOICE_LINE,
    tools: [],
    model: { provider: "faux", modelId: "faux-1" },
  }),
});
transcript.begin();
transcript.record({ role: "user", turn: 1, text: VOICE_LINE, interrupted: false });
// In the app the store's debounced write has long gone out by the time a reply is 200 characters in.
await store.flush();
let heard = "";
let fired = false;
await model.ask({
  turn: 1,
  text: VOICE_LINE,
  onDelta: (chunk) => {
    heard += chunk;
    if (!fired && heard.length >= 200) {
      fired = true;
      process.stdout.write("ARMED\n");
    }
  },
  onActivity: () => {},
  signal: new AbortController().signal,
});
await new Promise<never>(() => {});
