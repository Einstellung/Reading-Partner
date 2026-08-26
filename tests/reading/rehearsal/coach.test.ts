// The coach: its prompt (src/reading/rehearsal/coach.ts) and the turn assembled
// around it (coach-turn.ts). What is pinned here is the posture the prompt has
// to keep — the two measures, and that a pass produces a change to the outline
// rather than a review — and that the turn mounts the tools that make that
// possible over the talk as it stands.
// Run: bun test.

import { expect, test } from "bun:test";
import { DEFAULT_SETTINGS, type Settings } from "../../../src/platform/app/settings";
import { buildCoachSystemPrompt, COACH_INSTRUCTIONS } from "../../../src/reading/rehearsal/coach";
import { buildCoachTurn } from "../../../src/reading/rehearsal/coach-turn";
import { putSegment, setSpine } from "../../../src/reading/talk/edit";
import { newTalkOutline, type TalkOutline } from "../../../src/reading/talk/types";

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "claude-sonnet-4-5",
};

function talk(): TalkOutline {
  let outline = newTalkOutline({ id: "o1", topicId: "t1", name: "The eye", now: 1 });
  outline = setSpine(
    outline,
    { thesis: "The eye throws most of it away", audience: "people with no vision course" },
    1,
  );
  outline = putSegment(
    outline,
    { body: "## Opening\n\nask what they see" },
    1,
    () => "s1",
  );
  return outline;
}

// docs/44: the risk is that someone who knows the material fills in the sentence
// that was never said and calls the talk clear. The audience line is the measure
// that stops it, and it is on the spine rather than in the instructions, so the
// prompt has to carry the spine.
test("the prompt holds both measures and the talk it is about", () => {
  const prompt = buildCoachSystemPrompt({ outline: talk(), topicName: "Vision" });
  expect(prompt).toContain("audience");
  expect(prompt).toContain("Audience: people with no vision course");
  expect(prompt).toContain("Through-line: The eye throws most of it away");
  expect(prompt).toContain('The talk: "The eye" (topic: Vision).');
  // The segment ids are the only handle the tools have.
  expect(prompt).toContain("(id: s1)");
});

// The retell's AI holds the book and asks; this one has been talked at. Saying
// the difference in the prompt is the whole reason there are two of them.
test("the instructions separate the coach from the retell's examiner", () => {
  expect(COACH_INSTRUCTIONS).toContain("not the examiner from the retell");
  expect(COACH_INSTRUCTIONS).toContain("not a blank sheet");
  // Only what was given this pass — and, since nothing records where the reader
  // was, only what the coach can hear them having said (docs/44).
  expect(COACH_INSTRUCTIONS).toContain("Say nothing about what you cannot hear");
  expect(COACH_INSTRUCTIONS).toContain("work out");
  expect(COACH_INSTRUCTIONS).toContain("where they were from what they said");
  // The product is a change to the talk, and the talk is a note it edits.
  expect(COACH_INSTRUCTIONS).toContain("a change to the talk, not a review");
  expect(COACH_INSTRUCTIONS).toContain("one block of markdown per segment");
  expect(COACH_INSTRUCTIONS).toContain("Never rewrite a segment into your own words");
});

test("a talk with nothing on it yet still assembles a prompt", () => {
  const prompt = buildCoachSystemPrompt({ outline: null });
  expect(prompt).toContain("nothing arranged yet");
});

test("the turn mounts the five tools that write a talk, over the live outline", async () => {
  let outline = talk();
  const turn = buildCoachTurn({
    outline,
    settings,
    history: [{ role: "user", text: "I have just given this talk out loud — pass 1" }],
    talk: {
      read: async () => outline,
      edit: async (change) => (outline = change(outline)),
    },
    now: () => 42,
  });
  expect(turn.tools.map((t) => t.name).sort()).toEqual([
    "move_talk_segment",
    "read_talk_outline",
    "remove_talk_segment",
    "set_talk_spine",
    "write_talk_segment",
  ]);
  expect(turn.messages).toHaveLength(1);
  expect(turn.refusal).toBe("");

  // Editing the note is the coach's one silent write: it heard the segment
  // given (docs/44), and the write lands in the file the panel reads.
  const write = turn.tools.find((t) => t.name === "write_talk_segment")!;
  await write.execute({ id: "s1", body: "## Opening\n\nask what they see, then wait" });
  expect(outline.segments[0].body).toBe("## Opening\n\nask what they see, then wait");
});

// A conversation anchored on the outline collects every pass ever given, and a
// pass is tens of KB. The one rung the ladder has is the history.
test("a conversation too long for the window is trimmed rather than refused", () => {
  const long = "word ".repeat(20_000);
  const history = Array.from({ length: 12 }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "ai") as "user" | "ai",
    text: `${long} ${i}`,
  }));
  const turn = buildCoachTurn({
    outline: talk(),
    settings: { ...settings, defaultModelId: "claude-opus-4-5" },
    history,
    talk: { read: async () => null, edit: async () => null },
  });
  expect(turn.messages.length).toBeLessThan(history.length);
  expect(turn.notice).toContain("earlier passes");
});
