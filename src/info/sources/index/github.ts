// Index provider stub for GitHub (docs/69). Replaced by the real adapter; until
// then a descriptor naming it fails as a source with a clear message.

import type { IndexProvider } from "../index-provider";

export const githubProvider: IndexProvider = {
  id: "github",
  name: "GitHub",
  hosts: ["api.github.com"],
  defaultLimit: 50,
  validateQuery: () => "the GitHub index adapter is not implemented yet",
  describeQuery: () => "not implemented",
  discover: async () => [],
};
