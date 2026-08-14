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
import { dropViewStateCache, STATE_FILE } from "../app/storage";
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

/**
 * Whether a route is subscribed right now. For the routes registered at import
 * time, which have nothing else to show that they ran: a registration that is
 * deleted or made inert takes its files' refresh with it and nothing throws.
 */
export function isPullRouteRegistered(route: PullRoute): boolean {
  return routes.has(route);
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

// What the route drops, taken as an argument: the stores are module singletons
// over Tauri, and swapping a module out for a test poisons every other test file
// sharing the worker (pitfall 119).
export interface BookCacheDrops {
  threads: (bookId: string) => void;
  annotations: (bookId: string) => void;
  // reading-state.json is one map of every book's position rather than a file
  // per book, but it is the same problem: storage.ts keeps the map it last saw
  // so the way out of the app can write in one IPC, and a pull that landed
  // another device's positions would be undone by that write.
  //
  // storage.ts also drops that map off the write itself, which is what actually
  // closes the window — a pass writes reading-state.json in the middle and gets
  // here at the end, if it gets here. This stays because the range's contract is
  // that every synced file has a route, and because syncFs's fallback for bytes
  // that are not valid UTF-8 does not go through the atomic writer.
  viewStates: () => void;
}

// The book-keyed caches, which no shell has anything to decide about: every one
// of these stores writes itself back in full, so a cache the pull did not
// invalidate erases whatever the other device added on the next mark. Registered
// here rather than by a shell — App registered it and PhoneApp did not, which
// left the phone's info threads masked by a stale cache after every pull.
export function bookCachePullRoute(drop: BookCacheDrops): PullRoute {
  return {
    id: "book-caches",
    matches: (path) =>
      THREADS_FILE.test(path) || ANNOTATIONS_FILE.test(path) || path === STATE_FILE,
    onPulled: (paths) => {
      for (const path of paths) {
        const threads = THREADS_FILE.exec(path);
        if (threads) drop.threads(threads[1]);
        const annotations = ANNOTATIONS_FILE.exec(path);
        if (annotations) drop.annotations(annotations[1]);
        if (path === STATE_FILE) drop.viewStates();
      }
    },
  };
}

// The one the app runs on, registered for the life of the process.
export const BOOK_CACHE_PULL_ROUTE: PullRoute = bookCachePullRoute({
  threads: dropThreadCache,
  annotations: dropAnnotationCache,
  viewStates: dropViewStateCache,
});

registerPullRoute(BOOK_CACHE_PULL_ROUTE);
