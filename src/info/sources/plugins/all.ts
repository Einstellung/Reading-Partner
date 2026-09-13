// Register every source plugin (docs/69). Imported once by the program
// (info/program/live.ts) so the engine can resolve `index` descriptors; a test
// imports the one provider it exercises and registers it itself.
//
// Each plugin file exports its plugin object and registers nothing on
// import, so this is the only place the set is spelled out.

import { registerSourcePlugin } from "../plugin";
import { arxivPlugin } from "./arxiv";
import { githubPlugin } from "./github";
import { huggingfacePlugin } from "./huggingface";
import { s2Plugin } from "./s2";

export function registerAllSourcePlugins(): void {
  registerSourcePlugin(arxivPlugin);
  registerSourcePlugin(githubPlugin);
  registerSourcePlugin(huggingfacePlugin);
  registerSourcePlugin(s2Plugin);
}
