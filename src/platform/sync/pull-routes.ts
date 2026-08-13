// Who hears about which file a sync pull wrote.
//
// Four subscribers used to sit on the raw path list, each re-deriving its own
// subset with a regex or an includes(), and nothing tied any of them to the
// range in syncFs.ts: a file could be added to sync and the shell holding it in
// memory would go on serving the copy it loaded before the pull. Nothing fails
// when that happens; the pulled value simply never appears.
//
// A route is a name, what it matches, and what to do about it. The name and the
// matcher are declared as a constant where the file's own knowledge lives, so
// tests/platform/sync/pull-coverage.test.ts can walk them against ROOT_FILES and
// inSyncRange and fail on a synced file that no route claims and that nobody has
// written down as having no in-memory state.

import { dropAnnotationCache } from "../app/annotations";
import { dropThreadCache } from "../app/threads";

// A route without its handler: the half that can be stated up front, and the
// half the coverage test reads.
export interface PullMatcher {
  // Names the route in the coverage test's report.
  id: string;
  matches: (path: string) => boolean;
}

export interface PullRoute extends PullMatcher {
  // The paths this pull wrote that this route matched. Never called empty: a
  // route hears nothing when the pull touched none of its files.
  onPulled: (paths: string[]) => void;
}

const routes = new Set<PullRoute>();

/** Subscribe a route. Returns the undo. */
export function registerPullRoute(route: PullRoute): () => void {
  routes.add(route);
  return () => {
    routes.delete(route);
  };
}

/** What a finished pull calls (platform/sync/index.ts). */
export function dispatchPull(paths: readonly string[]): void {
  for (const route of [...routes]) {
    const mine = paths.filter(route.matches);
    if (mine.length > 0) route.onPulled(mine);
  }
}

const THREADS_FILE = /^threads-(.+)\.json$/;
const ANNOTATIONS_FILE = /^annotations-(.+)\.json$/;

// The per-book caches, which no shell has anything to decide about: both stores
// write themselves back in full, so a cache the pull did not invalidate erases
// whatever the other device added on the next mark. Registered here rather than
// by a shell — App registered it and PhoneApp did not, which left the phone's
// info threads masked by a stale cache after every pull.
export const BOOK_CACHE_PULL_ROUTE: PullMatcher = {
  id: "book-caches",
  matches: (path) => THREADS_FILE.test(path) || ANNOTATIONS_FILE.test(path),
};

registerPullRoute({
  ...BOOK_CACHE_PULL_ROUTE,
  onPulled: (paths) => {
    for (const path of paths) {
      const threads = THREADS_FILE.exec(path);
      if (threads) dropThreadCache(threads[1]);
      const annotations = ANNOTATIONS_FILE.exec(path);
      if (annotations) dropAnnotationCache(annotations[1]);
    }
  },
});
