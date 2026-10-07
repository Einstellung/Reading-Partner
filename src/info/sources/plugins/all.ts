// Register every source plugin (docs/69). Imported once by the program
// (info/program/live.ts) so the engine can resolve `index` descriptors; a test
// imports the one provider it exercises and registers it itself.
//
// Each plugin file exports its plugin object and registers nothing on
// import, so this is the only place the set is spelled out.

import { registerSiteAdapter } from "../../../workshop/bindery";
import { registerSourcePlugin, type SourcePlugin } from "../plugin";
import { arxivPlugin } from "./arxiv";
import { githubPlugin } from "./github";
import { huggingfacePlugin } from "./huggingface";
import { s2Plugin } from "./s2";

const PLUGINS: readonly SourcePlugin[] = [arxivPlugin, githubPlugin, huggingfacePlugin, s2Plugin];

export function registerAllSourcePlugins(): void {
  for (const plugin of PLUGINS) registerSourcePlugin(plugin);
}

/**
 * Hand the bindery the site adapter of every plugin that reads its library's
 * own links (docs/85). Called once from the shells' bootDomains.
 */
export function registerSourceSiteAdapters(): void {
  for (const plugin of PLUGINS) if (plugin.site) registerSiteAdapter(plugin.site);
}
