// When the home says nothing is being collected, and what it says instead of a
// raw pipeline error. Run: scripts/t.sh tests/ui/components/info/no-labs.test.ts

import { expect, test } from "bun:test";
import { NO_LABS_ERROR } from "../../../../src/info/boxes/pipeline";
import {
  briefingErrorText,
  noLabNotice,
  noLabsOpen,
} from "../../../../src/ui/components/info/no-labs";
import type { Lab } from "../../../../src/info/labs/types";

function lab(id: string, over: Partial<Lab> = {}): Lab {
  return {
    id,
    name: id,
    kind: "lab",
    status: "active",
    charter: { scope: "s", questions: ["q"], topicId: null },
    sources: [],
    createdAt: 1,
    ...over,
  };
}

test("an unread labs file asks for neither the notice nor a settled card", () => {
  expect(noLabsOpen(null)).toBe(null);
});

test("a device that has never opened a room gets the notice", () => {
  expect(noLabsOpen([])).toBe(true);
});

test("one open room is enough to keep the notice off", () => {
  expect(noLabsOpen([lab("lab-1")])).toBe(false);
  expect(noLabsOpen([lab("lab-1", { status: "archived", archivedAt: 9 }), lab("lab-2")])).toBe(false);
});

test("a file of nothing but closed rooms collects nothing, so it gets the notice", () => {
  const closed = [
    lab("lab-1", { status: "archived", archivedAt: 9 }),
    lab("lab-2", { status: "archived", archivedAt: 9 }),
  ];
  expect(noLabsOpen(closed)).toBe(true);
});

test("a run that refused for want of a room shows the notice, not its error", () => {
  expect(briefingErrorText(NO_LABS_ERROR)).toBe(noLabNotice());
});

test("every other error reaches the reader as it came", () => {
  expect(briefingErrorText("The provider returned 429.")).toBe("The provider returned 429.");
  expect(briefingErrorText(null)).toBe(null);
  expect(briefingErrorText(undefined)).toBe(null);
  expect(briefingErrorText("")).toBe(null);
});

test("the notice says what stopped, why, and what to do about it", () => {
  const notice = noLabNotice();
  expect(notice).toContain("No lab is open");
  expect(notice).toContain("no briefing is being built");
  expect(notice).toContain("the companion will propose one");
});
