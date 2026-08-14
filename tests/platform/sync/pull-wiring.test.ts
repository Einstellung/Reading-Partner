// The two ends of the pull-route table that pull-coverage.test.ts cannot see.
//
// That test walks the routes' matchers against everything sync carries, so it
// answers "is this file claimed by somebody". Either end of the table can still
// be unplugged with every one of its assertions green: the pass can stop calling
// dispatchPull, and a route registered at import time can be registered inert.
// Both failures are silent — no throw, no log, and the file's pulled bytes
// simply never reach the store holding the old ones in memory.
//
// So this file drives the ends: what the engine is built with, and what the
// book-cache route does when a pull hands it its files. Run: bun test.

import { expect, test } from "bun:test";
import { engineDeps } from "../../../src/platform/sync";
import {
  BOOK_CACHE_PULL_ROUTE,
  bookCachePullRoute,
  dispatchPull,
  isPullRouteRegistered,
  registerPullRoute,
} from "../../../src/platform/sync/pull-routes";

// The engine's own announcement, taken from the deps the engine is constructed
// with rather than from the source: onPulled is the single call the whole table
// hangs off, and a no-op there stops every route at once.
test("the engine announces a finished pull to the route table", () => {
  const heard: string[][] = [];
  const off = registerPullRoute({
    id: "test-only-engine-pull",
    matches: (path) => path.startsWith("mine-"),
    onPulled: (paths) => heard.push(paths),
  });

  const deps = engineDeps("desktop");
  expect(typeof deps.onPulled).toBe("function");
  deps.onPulled?.(["mine-a.json", "theirs.json", "mine-b.json"]);

  expect(heard).toEqual([["mine-a.json", "mine-b.json"]]);
  off();
});

// The other thing makeEngine decides. A phone that mirrors books fills a phone
// with PDFs it will never open (docs/22).
test("books travel to a shell that opens them and to no other", () => {
  expect(engineDeps("desktop").booksPolicy).toBe("mirror");
  expect(engineDeps("phone").booksPolicy).toBe("off");
});

function recordingRoute() {
  const dropped: string[] = [];
  const route = bookCachePullRoute({
    threads: (bookId) => dropped.push(`threads:${bookId}`),
    annotations: (bookId) => dropped.push(`annotations:${bookId}`),
    viewStates: () => dropped.push("view-states"),
  });
  return { dropped, route };
}

// Driven through dispatchPull rather than by calling onPulled: the route's
// matcher decides which of the pull's paths its handler is given, and the book
// id the handler drops is cut out of the filename by the same regexes.
test("a pull of a book's threads or marks drops that book's cache", () => {
  const { dropped, route } = recordingRoute();
  const off = registerPullRoute(route);

  dispatchPull([
    "threads-abc123.json",
    "annotations-abc123.json",
    "threads-talk-t1.json",
    "reading-state.json",
    "library.json",
  ]);

  expect(dropped).toEqual([
    "threads:abc123",
    "annotations:abc123",
    "threads:talk-t1",
    "view-states",
  ]);
  off();

  dispatchPull(["threads-abc123.json"]);
  expect(dropped.length).toBe(4);
});

// The registration itself, which is a bare statement at the bottom of
// pull-routes.ts with nothing else to show for it. Deleted or made inert, both
// caches go on serving the copy they loaded before the pull.
test("the book-cache route is registered on import, for the life of the process", () => {
  expect(isPullRouteRegistered(BOOK_CACHE_PULL_ROUTE)).toBe(true);
  expect(BOOK_CACHE_PULL_ROUTE.id).toBe("book-caches");
});
