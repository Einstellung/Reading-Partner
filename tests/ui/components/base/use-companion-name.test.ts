// The companion's name as the screens read it (docs/companion/90): fed from the
// settings, defaulting to Kris, and spoken into every label that means the
// companion in all nine languages.
//
// Run: bun test.
import { afterEach, expect, test } from "bun:test";

import { LOCALES } from "../../../../src/i18n/locale";
import { translate } from "../../../../src/i18n/translate";
import {
  applyCompanionNameSetting,
  currentCompanionName,
  resetCompanionNameForTest,
  subscribeCompanionName,
} from "../../../../src/ui/components/base/use-companion-name";

afterEach(resetCompanionNameForTest);

test("the name is Kris until a setting says otherwise", () => {
  expect(currentCompanionName()).toBe("Kris");
  applyCompanionNameSetting({ companionName: "" });
  expect(currentCompanionName()).toBe("Kris");
  applyCompanionNameSetting({ companionName: "   " });
  expect(currentCompanionName()).toBe("Kris");
});

test("a set name is read through companionNameOf and reaches subscribers once", () => {
  let heard = 0;
  const stop = subscribeCompanionName(() => void heard++);
  applyCompanionNameSetting({ companionName: "  Mira   Lee " });
  expect(currentCompanionName()).toBe("Mira Lee");
  // The same name again is no change.
  applyCompanionNameSetting({ companionName: "Mira Lee" });
  expect(heard).toBe(1);
  applyCompanionNameSetting({ companionName: "" });
  expect(currentCompanionName()).toBe("Kris");
  stop();
  expect(heard).toBe(2);
});

const COMPANION_KEYS = [
  "shell.lumen.show",
  "shell.lumen.hide",
  "shell.lumen.tapToChat",
  "shell.lumen.inCall",
  "shell.door.title",
  "shell.door.placeholder",
  "settings.features.lumen",
  "settings.features.lumenHint",
  "reader.top.lumen",
  "phone.displaySheet.lumen",
  "info.shelf.empty",
];

test("every label that means the companion carries the name in every language", () => {
  for (const locale of LOCALES) {
    for (const key of COMPANION_KEYS) {
      const text = translate(locale, key, { name: "Zorblax" });
      expect(text, `${locale} ${key}`).toContain("Zorblax");
      expect(text, `${locale} ${key}`).not.toContain("Lumen");
      expect(text, `${locale} ${key}`).not.toContain("卢明");
      expect(text, `${locale} ${key}`).not.toContain("{name}");
    }
  }
});

test("the product's own name stays in the briefing cover", () => {
  for (const locale of LOCALES) {
    expect(translate(locale, "info.issue.book.coverKicker"), locale).toContain("Lumen");
  }
});
