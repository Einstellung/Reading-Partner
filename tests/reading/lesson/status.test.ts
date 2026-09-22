// The lines a lesson screen shows while a PDF is being made readable
// (src/reading/lesson/status.ts). Run: bun test.

import { expect, test } from "bun:test";
import {
  lessonStatus,
  noTextStatus,
  type LessonOpenFailure,
} from "../../../src/reading/lesson/status";

test("the two waits say which one it is", () => {
  expect(lessonStatus({ kind: "downloading" })).toBe("Downloading…");
  expect(lessonStatus({ kind: "reading" })).toBe("Reading the paper…");
});

test("every failure has a line, and no two share one", () => {
  const whys: LessonOpenFailure[] = ["download", "unreadable", "no-text"];
  const lines = whys.map((why) => lessonStatus({ kind: "failed", why }));
  for (const line of lines) expect(line.length).toBeGreaterThan(0);
  expect(new Set(lines).size).toBe(whys.length);
});

test("a scan is described as a scan, not as an error", () => {
  const line = noTextStatus();
  expect(line).toBe(lessonStatus({ kind: "failed", why: "no-text" }));
  expect(line).toContain("scan");
});

test("nothing shouts at the reader", () => {
  const all = [
    lessonStatus({ kind: "downloading" }),
    lessonStatus({ kind: "reading" }),
    lessonStatus({ kind: "failed", why: "download" }),
    lessonStatus({ kind: "failed", why: "unreadable" }),
    lessonStatus({ kind: "failed", why: "no-text" }),
  ];
  for (const line of all) {
    expect(line).not.toContain("!");
    expect(line.trim()).toBe(line);
  }
});
