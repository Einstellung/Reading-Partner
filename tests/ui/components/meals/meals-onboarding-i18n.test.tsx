// The Meals onboarding thread drawn in the UI language (MealsOnboarding.tsx,
// meals/screen/onboarding.ts): the opening line, the consent card's buttons
// and the later steps read English under English and the original Chinese
// under zh-CN.
// Run: scripts/t.sh tests/ui/components/meals/meals-onboarding-i18n.test.tsx

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import { useDom } from "../../../support/dom";

const { act, cleanup, fireEvent, render } = await useDom();

// Imported after the window is up, for the reason launch-placeholder.test.tsx
// gives: react-dom decides once, at evaluation, whether it is in a browser.
const { MealsOnboarding } = await import("../../../../src/ui/components/meals/MealsOnboarding");

const CJK = /[㐀-鿿]/;

let before: Locale;
beforeEach(() => {
  before = getLocale();
});
afterEach(() => {
  cleanup();
  setLocale(before);
});

const noop = async () => true;

test("English: the intro, the consent card and its buttons are English", async () => {
  setLocale("en");
  const { container, getByRole } = render(<MealsOnboarding existing={null} onFinish={noop} />);
  const text = container.textContent ?? "";
  expect(text).toContain("A few questions first");
  expect(text).toContain("Before planning I need your weight and body fat");
  expect(getByRole("button", { name: "Agree" })).toBeTruthy();
  expect(getByRole("button", { name: "Don't agree" })).toBeTruthy();
  expect(text).not.toMatch(CJK);

  await act(async () => {
    fireEvent.click(getByRole("button", { name: "Don't agree" }));
  });
  expect(container.textContent).toContain("I won't keep any body data");
  expect(container.textContent).not.toMatch(CJK);
});

test("English: the later steps and their answer bubbles are English", async () => {
  setLocale("en");
  const { container, getByRole } = render(<MealsOnboarding existing={null} onFinish={noop} />);
  const tap = async (name: string) => {
    await act(async () => {
      // Some options carry a second line, so the name starts with the label.
      fireEvent.click(getByRole("button", { name: new RegExp(`^${name}`) }));
    });
  };
  await tap("Agree");
  await tap("Lose fat");
  await tap("Male");
  await tap("Next");
  await tap("Mon");
  await tap("Wed");
  await tap("After work");
  await tap("Next");
  await tap("Mostly sitting");
  await tap("Supermarket");
  await tap("Microwave");
  await tap("No beef");
  expect(container.textContent).toContain("Which days a week do you train");
  expect(container.textContent).toContain("Male · 30 yr · 170 cm");
  expect(container.textContent).toContain("Mon, Wed · After work");
  await tap("Next");
  const text = container.textContent ?? "";
  expect(text).toContain("Done. ");
  expect(text).toContain("Make this week's plan");
  expect(text).not.toMatch(CJK);
});

test("zh-CN keeps the original lines and buttons", async () => {
  setLocale("zh-CN");
  const { container, getByRole } = render(<MealsOnboarding existing={null} onFinish={noop} />);
  expect(container.textContent).toContain("先问几个问题，都是点选，一两分钟。");
  expect(getByRole("button", { name: "同意" })).toBeTruthy();
  expect(getByRole("button", { name: "不同意" })).toBeTruthy();
  await act(async () => {
    fireEvent.click(getByRole("button", { name: "不同意" }));
  });
  expect(container.textContent).toContain("好，不存身体数据。");
});
