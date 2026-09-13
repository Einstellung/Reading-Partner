// Index provider stub for Hugging Face (docs/69). Replaced by the real adapter; until
// then a descriptor naming it fails as a source with a clear message.

import type { IndexProvider } from "../index-provider";

export const huggingfaceProvider: IndexProvider = {
  id: "huggingface",
  name: "Hugging Face",
  hosts: ["huggingface.co"],
  defaultLimit: 50,
  validateQuery: () => "the Hugging Face index adapter is not implemented yet",
  describeQuery: () => "not implemented",
  discover: async () => [],
};
