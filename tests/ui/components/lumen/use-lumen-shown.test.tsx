// Lumen's switch as one value for every place that shows it (docs/68): the
// shells' buttons, Settings and the phone reader's Display sheet.
//
// Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { useDom } from "../../../support/dom";

await useDom();

const { LUMEN_CORNER_KEY } = await import("../../../../src/ui/components/lumen/corner-pref");
const {
  currentLumenShown,
  resetLumenShownForTest,
  setLumenShown,
  subscribeLumenShown,
  toggleLumenShown,
} = await import("../../../../src/ui/components/lumen/use-lumen-shown");
const { default: FeaturesPanel } = await import(
  "../../../../src/ui/components/settings/FeaturesPanel"
);
const { DEFAULT_SETTINGS } = await import("../../../../src/platform/app/settings");

// Other files in the same run have read the store already.
beforeEach(() => {
  window.localStorage.clear();
  resetLumenShownForTest();
});

test("reads what this device last chose", () => {
  window.localStorage.setItem(LUMEN_CORNER_KEY, "0");
  expect(currentLumenShown()).toBe(false);
});

test("a change is written and reaches every subscriber", () => {
  let heard = 0;
  const stop = subscribeLumenShown(() => heard++);
  setLumenShown(false);
  expect(window.localStorage.getItem(LUMEN_CORNER_KEY)).toBe("0");
  expect(currentLumenShown()).toBe(false);
  toggleLumenShown();
  expect(currentLumenShown()).toBe(true);
  // Setting what is already there is no change.
  setLumenShown(true);
  stop();
  expect(heard).toBe(2);
});

// The checkbox that sits just before the card's label.
function lumenBox(): string {
  const html = renderToStaticMarkup(
    <FeaturesPanel
      settings={{ ...DEFAULT_SETTINGS }}
      onSettingsChange={() => {}}
      device={null}
      onDeviceChange={() => {}}
    />,
  );
  const label = html.indexOf("Show Lumen");
  expect(label).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf("<button", label), label);
}

test("Settings draws the switch on every shell, checked as the store says", () => {
  expect(lumenBox()).toContain('aria-checked="true"');
  setLumenShown(false);
  expect(lumenBox()).toContain('aria-checked="false"');
});
