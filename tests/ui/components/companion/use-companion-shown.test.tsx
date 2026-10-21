// The companion's switch as one value for every place that shows it (docs/68): the
// shells' buttons, Settings and the phone reader's Display sheet.
//
// Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { useDom } from "../../../support/dom";

await useDom();

const { COMPANION_CORNER_KEY } = await import("../../../../src/ui/components/companion/corner-pref");
const {
  currentCompanionShown,
  resetCompanionShownForTest,
  setCompanionShown,
  subscribeCompanionShown,
  toggleCompanionShown,
} = await import("../../../../src/ui/components/companion/use-companion-shown");
const { default: FeaturesPanel } = await import(
  "../../../../src/ui/components/settings/FeaturesPanel"
);
const { DEFAULT_SETTINGS } = await import("../../../../src/platform/app/settings");

// Other files in the same run have read the store already.
beforeEach(() => {
  window.localStorage.clear();
  resetCompanionShownForTest();
});

test("reads what this device last chose", () => {
  window.localStorage.setItem(COMPANION_CORNER_KEY, "0");
  expect(currentCompanionShown()).toBe(false);
});

test("a change is written and reaches every subscriber", () => {
  let heard = 0;
  const stop = subscribeCompanionShown(() => heard++);
  setCompanionShown(false);
  expect(window.localStorage.getItem(COMPANION_CORNER_KEY)).toBe("0");
  expect(currentCompanionShown()).toBe(false);
  toggleCompanionShown();
  expect(currentCompanionShown()).toBe(true);
  // Setting what is already there is no change.
  setCompanionShown(true);
  stop();
  expect(heard).toBe(2);
});

// The checkbox that sits just before the card's label.
function companionBox(): string {
  const html = renderToStaticMarkup(
    <FeaturesPanel
      settings={{ ...DEFAULT_SETTINGS }}
      onSettingsChange={() => {}}
      device={null}
      onDeviceChange={() => {}}
    />,
  );
  const label = html.indexOf("Show Kris");
  expect(label).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf("<button", label), label);
}

test("Settings draws the switch on every shell, checked as the store says", () => {
  expect(companionBox()).toContain('aria-checked="true"');
  setCompanionShown(false);
  expect(companionBox()).toContain('aria-checked="false"');
});
