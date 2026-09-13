// What a paste does to the open conversation (src/reading/session/paste-images).
// Run: bun test.

import { expect, test } from "bun:test";
import {
  createPasteHandler,
  NO_CLIPBOARD_IMAGE_HINT,
  NO_VISION_HINT,
  type PasteImageDeps,
  type PasteLike,
} from "../../../src/reading/session/paste-images";

type Item = { kind: string; type: string; getAsFile(): Blob | null };

function pasteEvent(over: { items?: Item[]; text?: string; empty?: boolean } = {}) {
  let prevented = false;
  const e: PasteLike = {
    clipboardData: over.empty
      ? null
      : {
          items: over.items ?? [],
          getData: () => over.text ?? "",
        },
    preventDefault: () => {
      prevented = true;
    },
  };
  return { e, wasPrevented: () => prevented };
}

const imageItem = (type = "image/png"): Item => ({
  kind: "file",
  type,
  getAsFile: () => new Blob(["png"], { type }),
});

function deps(over: Partial<PasteImageDeps> = {}) {
  const hints: string[] = [];
  const staged: string[] = [];
  const d: PasteImageDeps = {
    takesImages: () => true,
    hint: (text) => hints.push(text),
    stage: () => staged.push("staged"),
    readSystemImage: null,
    ...over,
  };
  return { deps: d, hints, staged };
}

test("an image on the event is staged and the paste is taken over", async () => {
  const { deps: d, hints, staged } = deps();
  const { e, wasPrevented } = pasteEvent({ items: [imageItem(), imageItem("image/jpeg")] });
  await createPasteHandler(d)(e);
  expect(staged.length).toBe(2);
  expect(hints).toEqual([""]);
  expect(wasPrevented()).toBe(true);
});

test("the event is taken over before anything is awaited", () => {
  const { deps: d } = deps();
  const { e, wasPrevented } = pasteEvent({ items: [imageItem()] });
  void createPasteHandler(d)(e);
  expect(wasPrevented()).toBe(true);
});

test("a model that cannot read images says so and stages nothing", async () => {
  const { deps: d, hints, staged } = deps({ takesImages: () => false });
  const { e } = pasteEvent({ items: [imageItem()] });
  await createPasteHandler(d)(e);
  expect(staged).toEqual([]);
  expect(hints).toEqual([NO_VISION_HINT]);
});

test("a file that is not an image is not an image", async () => {
  const { deps: d, staged } = deps();
  const { e, wasPrevented } = pasteEvent({
    items: [{ kind: "file", type: "application/pdf", getAsFile: () => new Blob(["x"]) }],
  });
  await createPasteHandler(d)(e);
  expect(staged).toEqual([]);
  expect(wasPrevented()).toBe(false);
});

test("pasted text keeps its default behaviour", async () => {
  const { deps: d, hints, staged } = deps({ readSystemImage: async () => ({ rgba: new Uint8Array(4), width: 1, height: 1 }) });
  const { e, wasPrevented } = pasteEvent({ text: "some words" });
  await createPasteHandler(d)(e);
  expect(staged).toEqual([]);
  expect(hints).toEqual([]);
  expect(wasPrevented()).toBe(false);
});

test("an empty paste with no host to ask is left alone", async () => {
  const { deps: d, hints, staged } = deps();
  const { e, wasPrevented } = pasteEvent({ empty: true });
  await createPasteHandler(d)(e);
  expect(staged).toEqual([]);
  expect(hints).toEqual([]);
  expect(wasPrevented()).toBe(false);
});

test("an image the event dropped is read from the host instead (pitfall 16)", async () => {
  const { deps: d, hints, staged } = deps({
    readSystemImage: async () => ({ rgba: new Uint8Array(4), width: 1, height: 1 }),
  });
  const { e, wasPrevented } = pasteEvent({ empty: true });
  await createPasteHandler(d)(e);
  expect(staged).toEqual(["staged"]);
  expect(hints).toEqual([""]);
  expect(wasPrevented()).toBe(true);
});

test("the fall back to the host takes the event over before it asks", () => {
  const { deps: d } = deps({
    readSystemImage: async () => ({ rgba: new Uint8Array(4), width: 1, height: 1 }),
  });
  const { e, wasPrevented } = pasteEvent({ empty: true });
  void createPasteHandler(d)(e);
  expect(wasPrevented()).toBe(true);
});

test("a host clipboard with no image in it says so rather than dropping the paste", async () => {
  const { deps: d, hints, staged } = deps({ readSystemImage: async () => null });
  const { e } = pasteEvent({ empty: true });
  await createPasteHandler(d)(e);
  expect(staged).toEqual([]);
  expect(hints).toEqual([NO_CLIPBOARD_IMAGE_HINT]);
});

test("the host's image is refused by a model that cannot read one", async () => {
  const { deps: d, hints, staged } = deps({
    takesImages: () => false,
    readSystemImage: async () => ({ rgba: new Uint8Array(4), width: 1, height: 1 }),
  });
  const { e } = pasteEvent({ empty: true });
  await createPasteHandler(d)(e);
  expect(staged).toEqual([]);
  expect(hints).toEqual([NO_VISION_HINT]);
});
