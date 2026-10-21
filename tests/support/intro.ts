// The companion's short introduction leads every assembled turn (soul/intro.ts,
// docs/companion/90). Tests about what comes after it — a desk's own blocks, a
// role's duty — check that it is there, exactly as the assembly would build it,
// and then read the rest.

import { expect } from "bun:test";
import { companionNameOf, DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";
import { introBlock } from "../../src/soul/intro";

interface Turn {
  systemPrompt: string;
}

/** The prompt after the intro, which depends on the companion's name alone. */
export function afterIntro(turn: Turn, settings: Pick<Settings, "companionName"> = DEFAULT_SETTINGS): string {
  const intro = introBlock(companionNameOf(settings));
  if (turn.systemPrompt === intro) return "";
  expect(turn.systemPrompt.startsWith(`${intro}\n\n`)).toBe(true);
  return turn.systemPrompt.slice(intro.length + 2);
}
