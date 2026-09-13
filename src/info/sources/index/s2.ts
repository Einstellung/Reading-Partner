// Index provider stub for Semantic Scholar (docs/69). Replaced by the real adapter; until
// then a descriptor naming it fails as a source with a clear message.

import type { IndexProvider } from "../index-provider";

export const s2Provider: IndexProvider = {
  id: "s2",
  name: "Semantic Scholar",
  hosts: ["api.semanticscholar.org"],
  defaultLimit: 50,
  validateQuery: () => "the Semantic Scholar index adapter is not implemented yet",
  describeQuery: () => "not implemented",
  discover: async () => [],
};
