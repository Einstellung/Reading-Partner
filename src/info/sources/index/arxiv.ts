// Index provider stub for arXiv (docs/69). Replaced by the real adapter; until
// then a descriptor naming it fails as a source with a clear message.

import type { IndexProvider } from "../index-provider";

export const arxivProvider: IndexProvider = {
  id: "arxiv",
  name: "arXiv",
  hosts: ["export.arxiv.org"],
  defaultLimit: 50,
  validateQuery: () => "the arXiv index adapter is not implemented yet",
  describeQuery: () => "not implemented",
  discover: async () => [],
};
