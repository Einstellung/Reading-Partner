// The site adapters (docs/85). The bindery knows no website: an adapter that
// reads one (X, an arXiv abstract page) is registered at startup by the domain
// that owns the knowledge, and the bindery asks the registry before falling back
// to its generic adapters.
//
// Registration is by name and the last one wins, as for desk kinds: a domain
// booting twice replaces its adapter rather than throwing. Among different
// names, the first registered that claims the material takes it.

import type { Adapter, Material } from "./material";

export interface SiteAdapter extends Adapter<Material> {
  /** Whether this adapter reads this material, usually decided by its URL. */
  claims(material: Material): boolean;
}

const ADAPTERS = new Map<string, SiteAdapter>();

/** Register a site adapter. Returns a function that removes it again. */
export function registerSiteAdapter(adapter: SiteAdapter): () => void {
  ADAPTERS.set(adapter.name, adapter);
  return () => {
    if (ADAPTERS.get(adapter.name) === adapter) ADAPTERS.delete(adapter.name);
  };
}

/** The names registered, in registration order. */
export function registeredSiteAdapters(): readonly string[] {
  return [...ADAPTERS.keys()];
}

/** The site adapter that claims this material, or null. */
export function siteAdapterFor(material: Material): SiteAdapter | null {
  for (const adapter of ADAPTERS.values()) {
    if (adapter.claims(material)) return adapter;
  }
  return null;
}
