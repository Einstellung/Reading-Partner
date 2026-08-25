// Bringing a deck in from outside (src/reading/rehearsal/import-deck.ts): the
// name it starts with, what counts as a deck, and the copy that has to land
// before the object does. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import {
  deckNameFromPath,
  importRehearsalDeck,
  isDeckPath,
} from "../../../src/reading/rehearsal/import-deck";
import { listRehearsalsForTopic } from "../../../src/reading/rehearsal/store";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
});

test("the name starts as the file's own, without the path or the extension", () => {
  expect(deckNameFromPath("/home/x/ppt/dist/智能简史.html")).toBe("智能简史");
  expect(deckNameFromPath("C:\\decks\\miniGPT.HTM")).toBe("miniGPT");
  expect(deckNameFromPath("/tmp/.html")).toBe("Untitled deck");
});

test("only an HTML deck is taken", () => {
  expect(isDeckPath("/x/deck.html")).toBe(true);
  expect(isDeckPath("/x/deck.htm")).toBe(true);
  // A real .pptx is not read by anything here yet (docs/43), and taking one
  // would make a rehearsal that cannot be opened.
  expect(isDeckPath("/x/deck.pptx")).toBe(false);
});

test("the deck is copied into AppData and the rehearsal points at the copy", async () => {
  disk.blobs.set("/outside/智能简史.html", new TextEncoder().encode("<html>deck</html>"));
  const made = await importRehearsalDeck({
    topicId: "topic-1",
    sourcePath: "/outside/智能简史.html",
    now: 42,
  });
  expect(made.name).toBe("智能简史");
  expect(made.deckFile).toBe("rehearsals/42.html");
  expect(made.retellId).toBeNull();
  // The copy, not the path: a path outside AppData means nothing on the iPad.
  expect(disk.blobs.has("rehearsals/42.html")).toBe(true);
  expect((await listRehearsalsForTopic("topic-1")).map((r) => r.id)).toEqual(["42"]);
});

// The object is written after the bytes, so a copy that fails leaves no row in
// the list pointing at a deck that never landed.
test("nothing is written when the picked file cannot be read", async () => {
  await expect(
    importRehearsalDeck({ topicId: "topic-1", sourcePath: "/gone.html", now: 42 }),
  ).rejects.toThrow();
  expect(await listRehearsalsForTopic("topic-1")).toEqual([]);
});
