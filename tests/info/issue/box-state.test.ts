import { expect, test } from "bun:test";
import { createBoxStore, UNSEEN } from "../../../src/box/store";
import { markIssueTold } from "../../../src/info/issue/box-state";
import { ISSUE_BOX_KIND } from "../../../src/info/issue/types";
import { mapDisk } from "../../support/map-disk";

function issueItem(id: string, bookId: string) {
  return {
    id,
    boxId: `issue:${id}`,
    source: "run" as const,
    kind: ISSUE_BOX_KIND,
    cover: "Oct 15 brief · 6 items",
    body: bookId,
    origin: { place: "door" as const, date: "2026-10-15" },
    at: 1_000,
  };
}

test("opening an issue moves its own box item to told and leaves the others", async () => {
  const box = createBoxStore(mapDisk());
  const a = await box.put({ ...issueItem("b-" + "a".repeat(32), "book-a") });
  const b = await box.put({ ...issueItem("b-" + "b".repeat(32), "book-b") });
  const other = await box.put({
    boxId: "x",
    source: "run",
    cover: "A translation is ready.",
    body: "book-a",
    origin: { place: "door", date: "2026-10-15" },
  });

  await markIssueTold(box, "book-a");

  expect((await box.get(a.id))?.state).toBe("told");
  expect((await box.get(b.id))?.state).toBe("in-box");
  // Only a brief-issue item counts, whatever else names the same book.
  expect((await box.get(other.id))?.state).toBe("in-box");
  expect((await box.open(UNSEEN)).map((i) => i.id).sort()).toEqual([b.id, other.id].sort());
});

test("an issue already told or dismissed is left as it is, and one with no item is nothing", async () => {
  const box = createBoxStore(mapDisk());
  const gone = await box.put({ ...issueItem("b-" + "c".repeat(32), "book-c") });
  await box.setState(gone.id, "dismissed");

  await markIssueTold(box, "book-c");
  await markIssueTold(box, "book-none");

  expect((await box.get(gone.id))?.state).toBe("dismissed");
});
