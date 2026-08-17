// The whole card registry, gathered from the domains that contribute cards.
// MessageBubble renders a card part by looking up its kind here.
//
// It is its own module rather than a table inside one domain's card file because
// the union in chatParts.ts is shared: an entry missing for any kind is a
// compile error here (the CardRegistry annotation below), which is where a new
// card kind is meant to be noticed.
//
// It sits above chat/, info/ and reader/ rather than inside chat/, because
// gathering means importing all three and chat is what the other two import for
// the card protocol. It reaches a chat through CardRegistryProvider, which is
// what a shell mounts.

import type { CardRegistry } from "./chat/chatParts";
import { DIAGRAM_CARD_REGISTRY } from "./diagram/DiagramCard";
import { INFO_CARD_REGISTRY } from "./info/InfoCards";
import { READING_CARD_REGISTRY } from "./reader/RehearsalCard";

export const CARD_REGISTRY: CardRegistry = {
  ...INFO_CARD_REGISTRY,
  ...READING_CARD_REGISTRY,
  ...DIAGRAM_CARD_REGISTRY,
};
