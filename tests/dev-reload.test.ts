import { describe, expect, test } from "bun:test";
import { RELOAD_LIMIT, reloadAfterFailedShell, shellLoaded } from "../src/dev-reload";

function memoryStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("reloadAfterFailedShell", () => {
  test("reloads up to the limit, then gives up and resets", () => {
    const store = memoryStore();
    let reloads = 0;
    for (let i = 0; i < RELOAD_LIMIT; i++) {
      expect(reloadAfterFailedShell(store, () => reloads++)).toBe(true);
    }
    expect(reloadAfterFailedShell(store, () => reloads++)).toBe(false);
    expect(reloads).toBe(RELOAD_LIMIT);
    expect(reloadAfterFailedShell(store, () => reloads++)).toBe(true);
  });

  test("a loaded shell gives the next failure the full count", () => {
    const store = memoryStore();
    let reloads = 0;
    for (let i = 0; i < RELOAD_LIMIT; i++) reloadAfterFailedShell(store, () => reloads++);
    shellLoaded(store);
    expect(reloadAfterFailedShell(store, () => reloads++)).toBe(true);
    expect(reloads).toBe(RELOAD_LIMIT + 1);
  });
});
