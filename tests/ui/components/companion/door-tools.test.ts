// The door's tools and what is said beside them (src/ui/components/companion/door-tools.ts):
// web_search and read_page mount where the provider can search, and the
// paragraph on when to search rides with them; elsewhere the line saying search
// is unavailable rides instead (docs/info/24). Run: scripts/t.sh.

import { expect, test } from "bun:test";
import { providers } from "../../../../src/ai/providers";
import { doorTools, doorToolsPrompt, type DoorToolPorts } from "../../../../src/ui/components/companion/door-tools";
import { WEB_SEARCH_PROMPT, WEB_SEARCH_UNAVAILABLE_PROMPT } from "../../../../src/websearch/prompt";

function ports(settings: DoorToolPorts["settings"]): DoorToolPorts {
  return {
    threadId: "door-t",
    date: "2026-10-18",
    raiseCard: () => {},
    links: [],
    settings,
    readerLines: () => [],
    latestTopicSearchCard: () => null,
    applyTopicSearchCard: async () => {},
  } as unknown as DoorToolPorts;
}

test("the door says when to search where it can, and that it cannot where it cannot", () => {
  const searching = doorTools(
    ports({ defaultProviderId: "anthropic", defaultModelId: providers.anthropic.getModels()[0].id, everydayModelId: null }),
  );
  const names = searching.map((t) => t.name);
  expect(names).toContain("web_search");
  expect(names).toContain("read_page");
  expect(doorToolsPrompt(searching)).toBe(WEB_SEARCH_PROMPT);

  const notSearching = doorTools(
    ports({ defaultProviderId: "groq", defaultModelId: providers.groq.getModels()[0].id, everydayModelId: null }),
  );
  expect(notSearching.map((t) => t.name)).not.toContain("web_search");
  expect(doorToolsPrompt(notSearching)).toBe(WEB_SEARCH_UNAVAILABLE_PROMPT);
});
