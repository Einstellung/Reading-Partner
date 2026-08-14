// Classroom-mode prompt assembly (src/reading/prep/classroom.ts), and what it
// says about the survey when the survey no longer fits. Pure. Run: bun test.

import { expect, test } from "bun:test";
import { FULLTEXT_VERSION, type Fulltext } from "../../../src/fulltext/types";
import {
  buildClassroomSystemPrompt,
  classroomPromptPrefix,
  classroomSurveyBody,
  type ClassroomContext,
} from "../../../src/reading/prep/classroom";

function ft(pages: string[]): Fulltext {
  return { version: FULLTEXT_VERSION, status: "ok", pages, outline: [] };
}

const SURVEY = ft(["page one body", "page two body", "page three body"]);

function ctx(over: Partial<ClassroomContext> = {}): ClassroomContext {
  return {
    topicName: "JITs",
    surveyName: "survey.pdf",
    fulltext: SURVEY,
    pageLabel: "2",
    chapterTitle: "One",
    selectionText: "inline caches",
    notes: [],
    prep: null,
    hasTools: true,
    ...over,
  };
}

test("the prefix inlines the survey page by page by default", () => {
  const prefix = classroomPromptPrefix("survey.pdf", SURVEY);
  expect(prefix).toContain('The full survey ("survey.pdf"), page by page:');
  expect(prefix).toContain("=== Page 2 ===\npage two body");
  // Stable across calls, so provider prompt caching can hold it.
  expect(prefix).toBe(classroomPromptPrefix("survey.pdf", SURVEY));
});

test("classroomSurveyBody is the part the prefix can give up", () => {
  const body = classroomSurveyBody(SURVEY);
  expect(body).toBe(
    "=== Page 1 ===\npage one body\n=== Page 2 ===\npage two body\n=== Page 3 ===\npage three body",
  );
  expect(classroomPromptPrefix("survey.pdf", SURVEY)).toContain(body);
  expect(classroomPromptPrefix("survey.pdf", SURVEY, false)).not.toContain(body);
});

// The failure this guards: the body goes but the sentence claiming the body is
// there stays, and the model starts describing pages it cannot see.
test("dropping the inline survey retracts every claim that it is in context", () => {
  const prompt = buildClassroomSystemPrompt(ctx({ inlineSurvey: false }));
  expect(prompt).not.toContain("already fully in your context");
  expect(prompt).not.toContain("digested the survey itself");
  expect(prompt).toContain("The survey is not in your context: read it with read_pages.");
  expect(prompt).toContain("It is too long to");
  expect(prompt).toContain("Do not");
  expect(prompt).toContain("3 pages");
  expect(prompt).not.toContain("page two body");
});

test("the inlined prompt keeps saying so", () => {
  const prompt = buildClassroomSystemPrompt(ctx());
  expect(prompt).toContain("The survey is already fully in your context above.");
  expect(prompt).toContain("digested the survey itself");
  expect(prompt).toContain("page two body");
});

// A note's [p.3] means page 3 of that paper. Inlined bare it lands in the
// survey's page namespace, and a citation copied out of it jumps to the wrong
// book. It is qualified on the way into the prompt, the same way read_note
// returns it.
test("an inlined note's page anchors name their own paper", () => {
  const notes = [
    {
      slug: "world-models",
      title: "World Models",
      body: "I have enough to write the note.\n\nA controller [p.4] and a range [p.6-7].",
    },
  ];
  const prompt = buildClassroomSystemPrompt(ctx({ notes }));
  expect(prompt).toContain("A controller [world-models p.4] and a range [world-models p.6-7].");
  // The writer's own aside does not go into the prompt.
  expect(prompt).not.toContain("I have enough to write the note.");
});

test("everything outside the survey body is unchanged by the drop", () => {
  const notes = [{ slug: "smith2023", title: "Smith 2023", body: "note body" }];
  const inlined = buildClassroomSystemPrompt(ctx({ notes }));
  const dropped = buildClassroomSystemPrompt(ctx({ notes, inlineSurvey: false }));
  for (const part of ["- Marked passage: \"inline caches\"", "- Chapter: One", "smith2023", "note body"]) {
    expect(inlined).toContain(part);
    expect(dropped).toContain(part);
  }
});
