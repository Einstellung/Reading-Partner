// The companion's introduction leads every assembled turn (soul/intro.ts,
// docs/companion/90). Tests about what comes after it — a desk's own blocks, a
// role's duty — check that it is there, exactly as the assembly would build it,
// and then read the rest.

import { expect } from "bun:test";
import { listPlaces } from "../../src/desk";
import { companionNameOf, DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";
import { introBlock } from "../../src/soul/intro";

interface Turn {
  systemPrompt: string;
  tools: readonly { name: string; description: string }[];
}

/**
 * The prompt after the intro. `notSoul` names the tools in the turn that the
 * desk or the surface brought; every other tool is the soul's or the role's,
 * which is what the intro lists.
 */
export function afterIntro(
  turn: Turn,
  notSoul: readonly string[] = [],
  settings: Pick<Settings, "companionName"> = DEFAULT_SETTINGS,
): string {
  const intro = introBlock({
    name: companionNameOf(settings),
    places: listPlaces(),
    tools: turn.tools.filter((t) => !notSoul.includes(t.name)),
  });
  if (turn.systemPrompt === intro) return "";
  expect(turn.systemPrompt.startsWith(`${intro}\n\n`)).toBe(true);
  return turn.systemPrompt.slice(intro.length + 2);
}
