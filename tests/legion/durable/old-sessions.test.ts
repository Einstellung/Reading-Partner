import { expect, test } from "bun:test";
import { OLD_SESSIONS_DIR, removeOldSessions } from "../../../src/legion/durable/harness";

function fakeFs(present: boolean) {
  const removed: string[] = [];
  return {
    removed,
    fs: {
      exists: async (path: string) => present && path === OLD_SESSIONS_DIR,
      removeDir: async (path: string) => void removed.push(path),
    },
  };
}

test("the old session directory is removed when it is there and left alone when it is not", async () => {
  const there = fakeFs(true);
  await removeOldSessions(there.fs);
  expect(there.removed).toEqual(["session"]);
  const gone = fakeFs(false);
  await removeOldSessions(gone.fs);
  expect(gone.removed).toEqual([]);
});
