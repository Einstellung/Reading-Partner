// The retell turn's system prompt, whole, on one fixed input. The other tests
// here assert substrings, which is what catches a block that stopped being
// written; this one catches the opposite — a block that moved, a blank line that
// appeared, a paragraph that came out in a different order.
//
// Recorded before the retell moved onto the desk (docs/61) and kept as the guard
// that it came out the same afterwards: with nothing written down about the
// reader, the memory paragraph the assembly builds is empty and the prompt is
// the one this file recorded. Run: bun test.

import { expect, test } from "bun:test";
import { DEFAULT_SETTINGS, type Settings } from "../../../src/platform/app/settings";
import type { Fulltext } from "../../../src/fulltext/types";
import type { AnnotationLite } from "../../../src/fulltext/format";
import type { Figure } from "../../../src/reading/figures/types";
import type { LoadedMaterial } from "../../../src/reading/retell/material";
import type { Retell } from "../../../src/reading/retell/types";
import { newTalkOutline, type TalkOutline } from "../../../src/reading/talk/types";
import { putSegment, setSpine } from "../../../src/reading/talk/edit";
import { buildRetellTurn } from "../../../src/reading/retell/turn";

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "claude-sonnet-4-5",
};

function fulltext(): Fulltext {
  return {
    version: 1,
    status: "ok",
    pages: [
      "Page one about compilers.",
      "Page two about inline caches.",
      "Page three about deoptimization.",
      "Page four about the rest.",
    ],
    outline: [
      { title: "One", page: 1, level: 0 },
      { title: "Two", page: 3, level: 0 },
    ],
  };
}

const marks: AnnotationLite[] = [
  {
    page: 2,
    text: "an inline cache is a memo of the last lookup",
    comment: "why does this pay off?",
  },
];

const figures: Figure[] = [{ id: "1", page: 2, caption: "Inline cache layout", bbox: null }];

function material(): LoadedMaterial {
  return {
    bookId: "b1",
    title: "Eye and Brain",
    fulltext: fulltext(),
    annotations: marks,
    skeleton: {
      source: "outline",
      chapters: [
        { index: 1, title: "One", startPage: 1, endPage: 2, hasNote: false },
        { index: 2, title: "Two", startPage: 3, endPage: 4, hasNote: false },
      ],
    },
    figures,
    prep: null,
    prepNotes: [],
  };
}

function retell(): Retell {
  return {
    version: 1,
    id: "t1",
    name: "A retell",
    topicId: "topic-1",
    materials: [{ bookId: "b1", title: "Eye and Brain" }],
    createdAt: 1,
    updatedAt: 1,
    decisions: [],
  };
}

function talkOutline(): TalkOutline {
  let outline = newTalkOutline({ id: "o1", topicId: "topic-1", retellId: "t1", now: 1 });
  outline = setSpine(
    outline,
    { thesis: "The eye throws most of it away", audience: "people with no vision course" },
    1,
  );
  return putSegment(outline, { body: "## Opening\n\nask what they see" }, 1, () => "s1");
}

test("the whole prompt of a retell turn", async () => {
  const outline = talkOutline();
  const turn = await buildRetellTurn({
    retell: retell(),
    materials: [material()],
    topicName: "Vision",
    settings,
    history: [{ role: "user", text: "let's carry on" }],
    record: async () => {},
    talk: { read: async () => outline, edit: async () => outline },
  });
  expect(turn.systemPrompt).toMatchSnapshot();
});
