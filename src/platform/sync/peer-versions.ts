// Which desktop peers run an older build than this one, read off the `app`
// field every device puts in its holdings (docs/59). Phones and tablets update
// themselves through TestFlight; a desktop only updates when someone opens it,
// so the mobile app is where a lagging desktop gets noticed.
//
// Pure: the caller hands in the parsed peer holdings, this device's version and
// the clock.

import type { Holdings } from "./holdings";

export const DESKTOP_PLATFORMS: ReadonlySet<string> = new Set(["macos", "windows", "linux"]);

// A peer whose tree has not been published for this long is treated as gone:
// an old install, a reinstalled machine under a new device id.
export const PEER_STALE_MS = 30 * 24 * 60 * 60 * 1000;

export interface LaggingDesktop {
  device: string;
  platform: string;
  // What the peer runs, and what this device runs.
  version: string;
  target: string;
}

/** `"0.20.1 (macos)"` split into its two halves, or null for anything else. */
export function parseAppField(app: string): { version: string; platform: string } | null {
  const m = /^(\S+) \(([^)]+)\)$/.exec(app.trim());
  return m ? { version: m[1], platform: m[2] } : null;
}

// major.minor.patch as numbers. Anything else — "dev", a prerelease tag — is not
// a release and is never compared.
function parseRelease(version: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative when a is older than b, positive when newer, 0 when equal; null
 * when either is not a release version. */
export function compareVersions(a: string, b: string): number | null {
  const x = parseRelease(a);
  const y = parseRelease(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export function laggingDesktops(
  peers: readonly Holdings[],
  current: string,
  now: number,
): LaggingDesktop[] {
  const out: LaggingDesktop[] = [];
  for (const peer of peers) {
    if (!peer.app || now - peer.at > PEER_STALE_MS) continue;
    const parsed = parseAppField(peer.app);
    if (!parsed || !DESKTOP_PLATFORMS.has(parsed.platform)) continue;
    const cmp = compareVersions(parsed.version, current);
    if (cmp === null || cmp >= 0) continue;
    out.push({ device: peer.device, platform: parsed.platform, version: parsed.version, target: current });
  }
  // The most recently seen first: that is the machine the user is most likely
  // still using.
  const seen = new Map(peers.map((p) => [p.device, p.at]));
  return out.sort((a, b) => (seen.get(b.device) ?? 0) - (seen.get(a.device) ?? 0) || a.device.localeCompare(b.device));
}
