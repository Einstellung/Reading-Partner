// One spelling per URL, for keys (docs/88: events, material registry, the
// 30-day result history): scheme and host lowercased, the default port, the
// fragment and a trailing slash dropped, tracking parameters (utm_*, fbclid,
// gclid, ..., and X's share suffix ?s=&t=) removed, the rest sorted.
//
// Ported from ai-research-arm (scripts/source_cache.py: canonicalize_url,
// TRACKING_PARAM_PATTERNS, TRACKING_PARAM_HOST_RULES). Portions Copyright (c)
// 2026 guzus, under the MIT License; the full notice is in
// third-party-licenses.txt here.

const TRACKING_PARAM_PATTERNS: readonly RegExp[] = [
  /^utm_/,
  /^_hs(enc|mi)$/,
  /^mc_(cid|eid)$/,
  /^mkt_tok$/,
  /^oly_(anon_id|enc_id)$/,
  /^fbclid$/,
  /^gclid$/,
  /^dclid$/,
  /^msclkid$/,
  /^yclid$/,
  /^igshid$/,
];

// A short name that tracks on one host and carries content on another.
const X_SHARE = [/^s$/, /^t$/];
const TRACKING_PARAM_HOST_RULES: ReadonlyMap<string, readonly RegExp[]> = new Map([
  ["x.com", X_SHARE],
  ["twitter.com", X_SHARE],
  ["www.twitter.com", X_SHARE],
  ["mobile.twitter.com", X_SHARE],
]);

function isTrackingParam(name: string, host: string): boolean {
  const n = name.toLowerCase();
  if (TRACKING_PARAM_PATTERNS.some((p) => p.test(n))) return true;
  return (TRACKING_PARAM_HOST_RULES.get(host.toLowerCase()) ?? []).some((p) => p.test(n));
}

/** The canonical form of an http(s) URL; null for anything else. */
export function canonicalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  // URL already lowercases the scheme and host and drops a default port.
  let path = url.pathname || "/";
  if (path.length > 1 && path.endsWith("/")) path = path.replace(/\/+$/, "") || "/";
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !isTrackingParam(k, url.hostname))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const query = new URLSearchParams(params).toString();
  const auth = url.username ? `${url.username}${url.password ? `:${url.password}` : ""}@` : "";
  return `${url.protocol}//${auth}${url.host}${path}${query ? `?${query}` : ""}`;
}
