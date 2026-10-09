// Where the door panel stands on the iPad and the desktop
// (src/ui/components/lumen/door-panel.ts): on Lumen with no keyboard, on the
// keyboard with one up (docs/pitfall/506).
// Run: scripts/t.sh tests/ui/components/lumen/door-panel.test.ts

import { expect, test } from "bun:test";
import { NO_KEYBOARD } from "../../../../src/ui/components/common/useKeyboardInset";
import { panelOnKeyboard, panelPadding } from "../../../../src/ui/components/lumen/door-panel";

test("with no keyboard the panel stands on Lumen, above the corner's margin and its lift", () => {
  expect(panelPadding(NO_KEYBOARD, 0).paddingBottom).toBe("calc(max(24px, env(safe-area-inset-bottom)) + 80px)");
  expect(panelPadding(null, 40).paddingBottom).toBe("calc(max(24px, env(safe-area-inset-bottom)) + 120px)");
  expect(panelOnKeyboard(NO_KEYBOARD)).toBe(false);
  expect(panelOnKeyboard(null)).toBe(false);
});

test("with a keyboard up the panel stands 8px above it, whatever the lift", () => {
  // iPad Pro 11" landscape: the shell is 834 tall and 406 of it is visible.
  const keyboard = { covered: 428, cramped: false };
  expect(panelOnKeyboard(keyboard)).toBe(true);
  expect(panelPadding(keyboard, 0).paddingBottom).toBe("436px");
  expect(panelPadding(keyboard, 120).paddingBottom).toBe("436px");
});

test("the panel keeps 16px under the top inset either way", () => {
  const top = "calc(env(safe-area-inset-top) + 16px)";
  expect(panelPadding(NO_KEYBOARD, 0).paddingTop).toBe(top);
  expect(panelPadding({ covered: 300, cramped: false }, 0).paddingTop).toBe(top);
});
