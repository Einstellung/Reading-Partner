// The Settings screen drawn in another language (docs/ui/81): a static render
// of the whole body with the locale switched, which proves the migrated panels
// read the catalog rather than a literal. Run: bun test.

import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { useDom } from "../support/dom";

// Radix's Select pulls react-dom's client bundle, which decides at evaluation
// whether it is in a browser (docs/pitfall/121, 175): the window comes first.
await useDom();

const { SettingsBody } = await import("../../src/ui/components/SettingsView");
const { getLocale, setLocale } = await import("../../src/i18n");
const { DEFAULT_SETTINGS } = await import("../../src/platform/app/settings");

const initial = getLocale();
afterEach(() => setLocale(initial));

function render(): string {
  return renderToStaticMarkup(
    <SettingsBody
      settings={{ ...DEFAULT_SETTINGS }}
      onSettingsChange={() => {}}
      device={null}
      onDeviceChange={() => {}}
    />,
  );
}

test("the settings body follows the current locale", () => {
  setLocale("en");
  const en = render();
  expect(en).toContain("Account");
  expect(en).toContain("Providers");

  setLocale("zh-CN");
  const zh = render();
  expect(zh).toContain("账户");
  expect(zh).toContain("服务商");
  expect(zh).not.toContain("Providers");
});
