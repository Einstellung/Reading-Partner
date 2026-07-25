// One in-flight token refresh per provider.
//
// Both Anthropic and OpenAI rotate the refresh token on use: the old one is
// dead the moment the new one is issued. Prep, notes, slides, the briefing and
// chat are five independent module-level singletons that can all be running at
// once, so an expired token means several simultaneous getValidXxxAuth calls,
// each spending the same stored refresh token. The second exchange comes back
// invalid_grant and the user is signed out mid-session — with no way to tell
// why. Coalescing means the first caller refreshes and the rest wait for its
// result. Same shape as the extraction coalescing in figures/fulltext stores.

const inFlight = new Map<string, Promise<string | null>>();

/**
 * Run `refresh` for `provider`, or join the run already in progress. The
 * entry is cleared only after the refreshed token has been persisted, so a
 * caller that arrives afterwards reads the new credential rather than racing it.
 */
export function coalesceRefresh(
  provider: string,
  refresh: () => Promise<string | null>,
): Promise<string | null> {
  const existing = inFlight.get(provider);
  if (existing) return existing;
  const job = refresh();
  inFlight.set(provider, job);
  return job.finally(() => {
    inFlight.delete(provider);
  });
}
