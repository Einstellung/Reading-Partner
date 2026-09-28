// Pen colour names (src/ui/components/reader/color-label.ts): every colour the
// palette carries has a catalog word, and the word follows the locale.

import { expect, test } from "bun:test";
import { translatorFor } from "../../../../src/i18n";
import { ANNOTATION_COLORS } from "../../../../src/platform/app/annotations";
import { colorLabel } from "../../../../src/ui/components/reader/color-label";

test("every palette colour is named in English as the palette names it", () => {
  const en = translatorFor("en");
  for (const c of ANNOTATION_COLORS) expect(colorLabel(en, c.name)).toBe(c.name);
});

test("the name follows the locale, and an unknown name passes through", () => {
  expect(colorLabel(translatorFor("de"), "Yellow")).toBe("Gelb");
  expect(colorLabel(translatorFor("zh-CN"), "Gray")).toBe("灰色");
  expect(colorLabel(translatorFor("de"), "Teal")).toBe("Teal");
});
