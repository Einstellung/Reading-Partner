// The card table, mounted. A shell wraps the subtree that holds a chat in this,
// and that is all either shell has to know about cards.
//
// Its own component rather than the context and the table written out in both
// shells: what a shell that forgets to provide the table gets is not an error
// but nothing at all — every card part renders null, silently
// (chat/cardRegistryContext.ts). One identifier per shell is the smallest thing
// a test can look for, and tests/ui/components/chat/card-registry-context.test.tsx
// looks for it in both.
//
// The cards of a line whose experiment is off render nothing (card-gates.ts).

import { useMemo, type ReactNode } from "react";
import { CardRegistryContext } from "./chat/cardRegistryContext";
import { CARD_REGISTRY } from "./cardRegistry";
import { gatedRegistry, hiddenCardKinds } from "./card-gates";
import { useExperiment } from "./common/use-experiment";

export function CardRegistryProvider({ children }: { children: ReactNode }) {
  const meals = useExperiment("meals");
  const registry = useMemo(
    () => gatedRegistry(CARD_REGISTRY, hiddenCardKinds({ meals })),
    [meals],
  );
  return <CardRegistryContext.Provider value={registry}>{children}</CardRegistryContext.Provider>;
}
