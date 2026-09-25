// Switching topics while a list is still being read. The Retell and Rehearsal
// sections read their rows when the topic changes; a read for the topic just
// left can finish after the one for the topic now shown, and its rows must not
// land on the new topic's list.
//
// The store reads are replaced with spies (tests/support/preload.ts puts them
// back between cases) that resolve by hand, so the order they finish in is the
// test's to choose. Run: bun test.

import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import type { Topic } from "../../../../src/platform/app/topics";
import * as rehearsal from "../../../../src/reading/rehearsal";
import * as retell from "../../../../src/reading/retell";
import * as talk from "../../../../src/reading/talk";
import type { Rehearsal } from "../../../../src/reading/rehearsal";
import type { Retell } from "../../../../src/reading/retell";
import { useDom } from "../../../support/dom";

const { act, cleanup, render } = await useDom();
afterEach(cleanup);
// After useDom: both reach Radix, which loads react-dom.
const { default: RehearsalSection } = await import(
  "../../../../src/ui/components/library/topic/RehearsalSection"
);
const { default: RetellSection } = await import(
  "../../../../src/ui/components/library/topic/RetellSection"
);

const topicA: Topic = { id: "a", name: "A", createdAt: 1, files: [] };
const topicB: Topic = { id: "b", name: "B", createdAt: 2, files: [] };

// One pending read per topic id, released by the test.
function gate<T>() {
  const pending = new Map<string, (value: T) => void>();
  const read = (topicId: string) =>
    new Promise<T>((resolve) => {
      pending.set(topicId, resolve);
    });
  const release = async (topicId: string, value: T) => {
    await act(async () => {
      pending.get(topicId)!(value);
    });
  };
  return { read, release };
}

function aRetell(topicId: string, name: string): Retell {
  return {
    version: 1 as Retell["version"],
    id: `${topicId}-retell`,
    name,
    topicId,
    materials: [],
    createdAt: 1,
    updatedAt: 1,
    decisions: [],
  };
}

function aRehearsal(topicId: string, name: string): Rehearsal {
  return {
    version: 1 as Rehearsal["version"],
    id: `${topicId}-rehearsal`,
    topicId,
    name,
    outlineId: `${topicId}-outline`,
    retellId: null,
    createdAt: 1,
    updatedAt: 1,
  } as Rehearsal;
}

beforeEach(() => {
  spyOn(retell, "retellCandidates").mockResolvedValue([]);
  spyOn(rehearsal, "loadRehearsalRuns").mockResolvedValue({ runs: [] } as never);
  spyOn(talk, "listTalkOutlinesForTopic").mockResolvedValue([]);
});

// Asserting on the text rather than queryByText: a failing queryByText prints
// the whole element, which takes happy-dom half a minute.
const text = (view: { container: HTMLElement }) => view.container.textContent ?? "";

test("a retell list read for the topic just left does not land on the new one", async () => {
  const retells = gate<Retell[]>();
  spyOn(retell, "listRetellsForTopic").mockImplementation(retells.read);
  const view = render(<RetellSection topic={topicA} onOpenRetell={() => {}} />);
  view.rerender(<RetellSection topic={topicB} onOpenRetell={() => {}} />);

  await retells.release("b", [aRetell("b", "Retell of B")]);
  expect(text(view)).toContain("Retell of B");

  await retells.release("a", [aRetell("a", "Retell of A")]);
  expect(text(view)).not.toContain("Retell of A");
  expect(text(view)).toContain("Retell of B");
});

test("a rehearsal list read for the topic just left does not land on the new one", async () => {
  const rehearsals = gate<Rehearsal[]>();
  spyOn(rehearsal, "listRehearsalsForTopic").mockImplementation(rehearsals.read);
  spyOn(retell, "listRetellsForTopic").mockResolvedValue([]);
  const props = { reloadKey: 0, onStart: () => {}, onTalk: () => {} };
  const view = render(<RehearsalSection topic={topicA} {...props} />);
  view.rerender(<RehearsalSection topic={topicB} {...props} />);

  await rehearsals.release("b", [aRehearsal("b", "Rehearsal of B")]);
  expect(text(view)).toContain("Rehearsal of B");

  await rehearsals.release("a", [aRehearsal("a", "Rehearsal of A")]);
  expect(text(view)).not.toContain("Rehearsal of A");
  expect(text(view)).toContain("Rehearsal of B");
});
