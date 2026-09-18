// Both keys are up while a reply streams (docs/72). Stop cuts the answer off
// and keeps the half sentence; Send says the next thing into the turn without
// cutting anything off. They do different things, so neither may replace the
// other on the composer row — which is what it used to do, in both the big
// pill and the corner bubble.
//
// Source text rather than a render: the two forms are branches of one
// component and what this guards is that neither branch is a ternary between
// the two buttons again. Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../src");
const chat = readFileSync(join(SRC, "ui/components/chat/chat.tsx"), "utf8");
const button = readFileSync(join(SRC, "ui/components/ui/button.tsx"), "utf8");

test("neither form chooses between Stop and Send", () => {
  // The shape that was there before: `streaming ? <Stop/> : <Send/>`.
  expect(chat).not.toMatch(/streaming \?[\s\S]{0,400}aria-label="Stop"[\s\S]{0,400}aria-label="Send"/);
  // Two of each: the pill's pair and the corner bubble's.
  expect(chat.match(/aria-label="Stop"/g)).toHaveLength(2);
  expect(chat.match(/aria-label="Send"/g)).toHaveLength(2);
});

test("the composer's round buttons take their size from the variant table", () => {
  // The 44px touch target belongs in one place (docs/30). A call site that
  // writes its own `coarse:h-11` is how it drifts back out of it.
  expect(button).toContain('composer: "h-9 w-9 rounded-full coarse:h-11 coarse:w-11"');
  expect(button).toContain('"composer-sm": "h-6 w-6 rounded-full coarse:h-11 coarse:w-11"');
  const composerArea = chat.slice(chat.indexOf("const stopInk"));
  expect(composerArea).not.toContain("coarse:h-11");
});
