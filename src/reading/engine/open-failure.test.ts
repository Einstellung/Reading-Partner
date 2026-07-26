import { expect, test } from "bun:test";
import { engineErrorText, openFailureText } from "./open-failure";

test("the reader is told which book, in words they can act on", () => {
  const t = openFailureText("Attention Is All You Need.pdf", new Error("Invalid PDF structure"));
  expect(t.toast).toContain("Attention Is All You Need.pdf");
  expect(t.toast).toContain("Couldn't open");
  // The engine's own text is in the console line and nowhere near the reader.
  expect(t.toast).not.toContain("Invalid PDF structure");
  expect(t.detail).toContain("Invalid PDF structure");
});

test("the status line stops claiming the book is still rendering", () => {
  const t = openFailureText("book.pdf", new Error("boom"));
  expect(t.status).not.toBe("");
  expect(t.status.toLowerCase()).not.toContain("render");
});

test("a book with no name still gets a sentence", () => {
  const t = openFailureText("   ", "boom");
  expect(t.toast).toContain("this book");
  expect(t.toast).not.toContain("“");
});

test("whatever the engine threw comes out as a line of text", () => {
  expect(engineErrorText(new Error("Invalid PDF structure"))).toBe("Invalid PDF structure");
  expect(engineErrorText("password required")).toBe("password required");
  // The plugin tasks reject with an object carrying a reason, not an Error.
  expect(engineErrorText({ reason: "wasm not loaded" })).toBe("wasm not loaded");
  expect(engineErrorText({ message: "  spaced  " })).toBe("spaced");
});

test("an error with nothing in it never produces an empty message", () => {
  expect(engineErrorText(new Error(""))).toBe("Error");
  expect(engineErrorText("   ")).toBe("no error given");
  expect(engineErrorText(undefined)).toBe("no error given");
  expect(engineErrorText(null)).toBe("no error given");
  expect(openFailureText("book.pdf", undefined).detail).toContain("no error given");
});
