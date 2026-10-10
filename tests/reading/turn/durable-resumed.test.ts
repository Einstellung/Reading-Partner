// A turn in flight on a book thread that nothing on screen holds — after a
// restart, the one recovery resumed (docs/soul/87, "被杀之后") — joined by the
// reader who opens the thread (reading/turn/durable-turn.ts resumedTurn,
// book-turn-rows.ts resumedBookTurn): it is found without creating anything,
// streams as rows, takes a steer, stops, and while it lands with no run left a
// line is not taken. The turn is started straight on the runtime, as recovery
// leaves it: no assembly in this process, no handle.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationsDoc } from "../../../src/legion/durable/extension";
import { startTurn } from "../../../src/legion/durable/turn";
import type { ThreadMessage } from "../../../src/platform/app/threads";
import { resumedBookTurn } from "../../../src/reading/turn/book-turn-rows";
import type { CallRow } from "../../../src/reading/turn/call-state";
import { bookThreadKey, bookThreadOrigin, type BookOrigin } from "../../../src/reading/turn/durable-book";
import { openReadingDurable, TURN_SECTION } from "../../../src/reading/turn/durable-runtime";
import { resumedTurn } from "../../../src/reading/turn/durable-turn";
import type { TurnView } from "../../../src/reading/turn/durable-view";
import { testHost } from "../../legion/durable/support/runtime";
import { fakeThreads } from "./support/durable-threads";

const BOOK: BookOrigin = { place: "book", bookId: "b1", threadId: "t1", home: "b1" };
const LONG = "The tide follows the moon, and the sun pulls too. ".repeat(30);

async function rig(replies: string[], file = fakeThreads([{ role: "user", ts: 1000, text: "Why tides?" }])) {
  const faux = fauxProvider({
    tokensPerSecond: 200,
    tokenSize: { min: 2, max: 3 },
    models: [{ id: "faux-1", contextWindow: 200_000, maxTokens: 4096 }],
  });
  faux.setResponses(replies.map((text) => fauxAssistantMessage(fauxText(text))));
  const models = createModels();
  models.setProvider(faux.provider);
  const durable = await openReadingDurable({
    catalog: [],
    host: testHost(mkdtempSync(join(tmpdir(), "reading-resumed-"))),
    models,
    threads: file.threads,
    watching: () => true,
    openDesk: async () => [],
    now: () => 1000,
  });
  const start = () =>
    startTurn(
      durable.runtime,
      {
        key: bookThreadKey(BOOK),
        origin: bookThreadOrigin(BOOK),
        content: "Why tides?",
        sections: { [TURN_SECTION]: "You are a reading partner." },
        tools: [],
        model: { provider: "faux", modelId: "faux-1" },
        excludeTs: 1000,
      },
      ctx,
    );
  return { durable, file, start };
}

function untilText(): { onView(view: TurnView): void; streaming: Promise<void>; views: TurnView[] } {
  const views: TurnView[] = [];
  let streamed!: () => void;
  const streaming = new Promise<void>((resolve) => (streamed = resolve));
  return {
    views,
    streaming,
    onView(view) {
      views.push(view);
      if (view.busy && ((view.rows[0] as { text?: string } | undefined)?.text?.length ?? 0) > 30) streamed();
    },
  };
}

test("an idle thread has nothing in flight, and looking creates no conversation", async () => {
  const { durable } = await rig([]);
  expect(await resumedTurn(durable, BOOK, ctx)).toBeUndefined();
  const threads = (await durable.runtime.harness.snapshot(ConversationsDoc, ctx))?.threads ?? {};
  expect(threads[bookThreadKey(BOOK)]).toBeUndefined();
  await durable.runtime.close(ctx);
});

test("a turn nobody here holds streams as rows, takes a steer, and is not in flight once it lands", async () => {
  const { durable, file, start } = await rig([LONG, "Shorter: the moon."]);
  const started = await start();
  const found = await resumedTurn(durable, BOOK, ctx);
  expect(found?.startedAt).toBe(started.startedAt);
  const seen = untilText();
  const turn = await found!.follow(seen.onView);
  await seen.streaming;
  expect(await turn.steer("Shorter please", 5000)).toBe(true);
  const { result } = await turn.settled;
  expect(result?.status).toBe("done");
  const landed = file.messages.slice(1).map((m) => [m.role, m.ts]);
  expect(landed).toEqual([
    ["ai", 1001],
    ["user", 5000],
    ["ai", 5001],
  ]);
  // What was on screen last is what landed, stamp for stamp.
  expect(seen.views[seen.views.length - 1]!.rows.map((r) => [r.role, r.ts])).toEqual(landed);
  expect(await resumedTurn(durable, BOOK, ctx)).toBeUndefined();
  await durable.runtime.close(ctx);
});

test("stopping a joined turn keeps what it said, and the rows say it stopped", async () => {
  const { durable, file, start } = await rig([LONG]);
  await start();
  const found = await resumedBookTurn(durable, BOOK, ctx);
  expect(found?.after).toBe(1000);
  let rows: CallRow[] = [];
  let streamed!: () => void;
  const streaming = new Promise<void>((resolve) => (streamed = resolve));
  const driven = await found!.follow((next) => {
    rows = next;
    if ((next[0]?.text.length ?? 0) > 30) streamed();
  });
  await streaming;
  expect(rows[0]?.streaming).toBe(true);
  driven.stop();
  const end = await driven.ended;
  expect(end.kind).toBe("stopped");
  if (end.kind !== "stopped") throw new Error("not stopped");
  expect(end.rows[0]?.streaming).toBeUndefined();
  const said = file.messages.slice(1);
  expect(said.map((m) => m.role)).toEqual(["ai"]);
  expect(LONG.startsWith(said[0]!.text)).toBe(true);
  await durable.runtime.close(ctx);
});

test("a turn landing with no run left is still in flight, and a line said then is not taken", async () => {
  const file = fakeThreads([{ role: "user", ts: 1000, text: "Why tides?" }]);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let landing!: () => void;
  const atFlush = new Promise<void>((resolve) => (landing = resolve));
  const flush = file.threads.flush;
  file.threads.flush = async () => {
    landing();
    await held;
    await flush();
  };
  const { durable, start } = await rig(["The moon."], file);
  await start();
  await atFlush;
  const found = await resumedTurn(durable, BOOK, ctx);
  expect(found).toBeDefined();
  const turn = await found!.follow(() => {});
  expect(await turn.steer("And the sun?", 5000)).toBe(false);
  release();
  const { result } = await turn.settled;
  expect(result?.status).toBe("done");
  expect(file.messages.map((m: ThreadMessage) => m.text)).toEqual(["Why tides?", "The moon."]);
  expect(await resumedTurn(durable, BOOK, ctx)).toBeUndefined();
  await durable.runtime.close(ctx);
});
