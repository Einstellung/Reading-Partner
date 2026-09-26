// What a night shows when it has no photograph of its own (docs/73 图片).
//
// The band belongs to the photograph. A dish drawn from its ingredients gets a
// row of small contained squares instead — a white-background cut-out stretched
// across a 16:9 band is a slab of raw beef, which is what the phone showed
// before this. Run: scripts/t.sh tests/ui/components/info/meals-dish-image.test.tsx

import { afterEach, expect, test } from "bun:test";
import { useDom } from "../../../../support/dom";

const { act, cleanup, fireEvent, render } = await useDom();
afterEach(cleanup);

// Imported after the window is up, for the reason launch-placeholder.test.tsx
// gives: react-dom decides once, at evaluation, whether it is in a browser.
const { DishImage } = await import("../../../../../src/ui/components/info/meals/MealsImages");

const CUTOUTS = ["/a.png", "/b.png", "/c.png", "/d.png"];

function imgs(container: HTMLElement): HTMLImageElement[] {
  return [...container.querySelectorAll("img")] as HTMLImageElement[];
}

test("a dish with a photograph keeps the band, and nothing else draws", () => {
  const { container } = render(
    <DishImage
      image="https://cdn.example/stew.jpg"
      thumbnails={CUTOUTS}
      alt="Chickpea stew"
      photoClassName="mt-3 aspect-[16/9] max-h-40 w-full"
      stripClassName="mt-3"
    />,
  );
  const drawn = imgs(container);
  expect(drawn).toHaveLength(1);
  expect(drawn[0]!.getAttribute("src")).toBe("https://cdn.example/stew.jpg");
  expect(drawn[0]!.className).toContain("aspect-[16/9]");
  expect(drawn[0]!.className).toContain("object-cover");
});

test("a dish with none draws a row of contained squares and no band", () => {
  const { container } = render(
    <DishImage
      thumbnails={CUTOUTS}
      alt="Chickpea stew"
      photoClassName="mt-3 aspect-[16/9] max-h-40 w-full"
      stripClassName="mt-3"
    />,
  );
  const drawn = imgs(container);
  expect(drawn).toHaveLength(4);
  for (const img of drawn) {
    expect(img.className).toContain("object-contain");
    expect(img.className).not.toContain("object-cover");
  }
  expect(container.innerHTML).not.toContain("aspect-[16/9]");
  // The square is the touch target's size on a phone and one notch down on a
  // desktop, which is the sizing the shopping lines already use.
  const tile = drawn[0]!.parentElement!;
  expect(tile.className).toContain("size-10");
  expect(tile.className).toContain("coarse:size-11");
});

test("a cut-out that fails takes its square with it, and the last one takes the row", () => {
  const { container } = render(<DishImage thumbnails={["/a.png", "/b.png"]} alt="Stew" />);
  expect(imgs(container)).toHaveLength(2);
  act(() => {
    fireEvent.error(imgs(container)[0]!);
  });
  const left = imgs(container);
  expect(left).toHaveLength(1);
  expect(left[0]!.getAttribute("src")).toBe("/b.png");
  act(() => {
    fireEvent.error(left[0]!);
  });
  expect(imgs(container)).toHaveLength(0);
  // Not an empty box either: a night with nothing to show takes up no room.
  expect(container.innerHTML).toBe("");
});

test("a photograph that fails falls back to the row, and says so once", () => {
  let told = 0;
  const { container } = render(
    <DishImage
      image="https://cdn.example/gone.jpg"
      thumbnails={["/a.png"]}
      alt="Stew"
      onPhotoFailed={() => {
        told += 1;
      }}
    />,
  );
  act(() => {
    fireEvent.error(imgs(container)[0]!);
  });
  expect(told).toBe(1);
  const drawn = imgs(container);
  expect(drawn).toHaveLength(1);
  expect(drawn[0]!.getAttribute("src")).toBe("/a.png");
  expect(drawn[0]!.className).toContain("object-contain");
});

test("a week row has space for one square only", () => {
  const { container } = render(<DishImage thumbnails={CUTOUTS} alt="Stew" size="row" />);
  const drawn = imgs(container);
  expect(drawn).toHaveLength(1);
  expect(drawn[0]!.parentElement!.className).toContain("size-8");
});
