// Every source plugin (docs/69), the one place the set is spelled out. Each
// plugin file exports its plugin object and registers nothing on import.

import { registerSiteAdapter } from "../../workshop/bindery";
import type { SourcePlugin } from "../plugin";
import { arxivPlugin } from "./arxiv";
import { githubPlugin } from "./github";
import { huggingfacePlugin } from "./huggingface";
import { s2Plugin } from "./s2";
import { driveSiteAdapter } from "../drive-site";

const PLUGINS: readonly SourcePlugin[] = [arxivPlugin, githubPlugin, huggingfacePlugin, s2Plugin];

/**
 * Hand the bindery the site adapter of every plugin that reads its library's
 * own links, and Drive's (docs/85). Called once from the shells' bootDomains.
 */
export function registerSourceSiteAdapters(): void {
  for (const plugin of PLUGINS) if (plugin.site) registerSiteAdapter(plugin.site);
  // Not a library: a host that serves documents whole (drive-site.ts).
  registerSiteAdapter(driveSiteAdapter);
}
