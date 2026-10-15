// A question asked about a passage (src/ui/components/chat/quoted-question.ts).

import { expect, test } from "bun:test";
import { quotedQuestion, splitQuotedQuestion } from "../../../../src/ui/components/chat/quoted-question";

test("the passage rides above the question as one quoted line, and comes back out", () => {
  const line = quotedQuestion("  the model\nwrites   proofs ", " Is that new? ");
  expect(line).toBe("> the model writes proofs\n\nIs that new?");
  expect(splitQuotedQuestion(line)).toEqual({ quote: "the model writes proofs", question: "Is that new?" });
});

test("a line that quotes nothing is all question", () => {
  expect(quotedQuestion("   ", "Just this")).toBe("Just this");
  expect(splitQuotedQuestion("Just this")).toEqual({ quote: null, question: "Just this" });
  expect(splitQuotedQuestion("> a quote with no question after it")).toEqual({
    quote: null,
    question: "> a quote with no question after it",
  });
});
