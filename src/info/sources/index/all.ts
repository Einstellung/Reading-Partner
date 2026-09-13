// Register every index provider (docs/69). Imported once by the program
// (info/program/live.ts) so the engine can resolve `index` descriptors; a test
// imports the one provider it exercises and registers it itself.
//
// Each provider file exports its provider object and registers nothing on
// import, so this is the only place the set is spelled out.

import { registerIndexProvider } from "../index-provider";
import { arxivProvider } from "./arxiv";
import { githubProvider } from "./github";
import { huggingfaceProvider } from "./huggingface";
import { s2Provider } from "./s2";

export function registerAllIndexProviders(): void {
  registerIndexProvider(arxivProvider);
  registerIndexProvider(githubProvider);
  registerIndexProvider(huggingfaceProvider);
  registerIndexProvider(s2Provider);
}
