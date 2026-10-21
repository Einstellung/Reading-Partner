// The companion-name field in Settings > Features: its text rules and what the
// panel draws for it.
//
// Run: bun test.
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { useDom } from "../../../support/dom";

await useDom();

const { COMPANION_NAME_CAP, DEFAULT_SETTINGS } = await import("../../../../src/platform/app/settings");
const { companionNameInput, companionNameToStore } = await import(
  "../../../../src/ui/components/settings/companion-name-field"
);
const { default: FeaturesPanel } = await import("../../../../src/ui/components/settings/FeaturesPanel");

test("typing keeps spaces and stops at the cap in characters", () => {
  expect(companionNameInput("Mary ")).toBe("Mary ");
  const long = "x".repeat(COMPANION_NAME_CAP + 5);
  expect(Array.from(companionNameInput(long))).toHaveLength(COMPANION_NAME_CAP);
  // A character outside the BMP counts once.
  const wide = "𠮷".repeat(COMPANION_NAME_CAP + 1);
  expect(Array.from(companionNameInput(wide))).toHaveLength(COMPANION_NAME_CAP);
});

test("leaving the field tidies the name, and nothing means the default", () => {
  expect(companionNameToStore("  Mary   Ann ")).toBe("Mary Ann");
  expect(companionNameToStore("")).toBe("");
  expect(companionNameToStore(" \t\n ")).toBe("");
});

function panel(companionName: string): string {
  return renderToStaticMarkup(
    <FeaturesPanel
      settings={{ ...DEFAULT_SETTINGS, companionName }}
      onSettingsChange={() => {}}
      device={null}
      onDeviceChange={() => {}}
    />,
  );
}

test("the field shows the default as its placeholder and holds what is stored", () => {
  const empty = panel("");
  expect(empty).toContain("Companion name");
  expect(empty).toContain('placeholder="Kris"');
  expect(empty).toContain(`maxLength="${COMPANION_NAME_CAP}"`);

  const set = panel("Mira");
  expect(set).toContain('value="Mira"');
  // The switch beside it says the name that was set.
  expect(set).toContain("Show Mira");
});
