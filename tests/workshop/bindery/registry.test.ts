// The site-adapter registry (src/workshop/bindery/registry.ts). The registry is
// one map for the whole process, so every case undoes what it registered.
// Run: bash scripts/t.sh tests/workshop/bindery/registry.test.ts

import { expect, test } from "bun:test";
import {
  registerSiteAdapter,
  registeredSiteAdapters,
  siteAdapterFor,
  type SiteAdapter,
} from "../../../src/workshop/bindery/registry";
import { materialUrl, type Material } from "../../../src/workshop/bindery/material";

function adapter(name: string, host: string): SiteAdapter {
  return {
    name,
    claims: (m) => materialUrl(m)?.hostname === host,
    toManuscript: async () => ({ title: name, sections: [{ html: "" }], images: [] }),
  };
}

const onX: Material = { kind: "url", url: "https://x.com/a/status/1" };

test("an adapter claims what it names and nothing else, and undoing removes it", () => {
  const undo = registerSiteAdapter(adapter("test-x", "x.com"));
  try {
    expect(registeredSiteAdapters()).toContain("test-x");
    expect(siteAdapterFor(onX)?.name).toBe("test-x");
    expect(siteAdapterFor({ kind: "url", url: "https://example.com/" })).toBeNull();
    expect(siteAdapterFor({ kind: "text", text: "no url at all" })).toBeNull();
  } finally {
    undo();
  }
  expect(registeredSiteAdapters()).not.toContain("test-x");
  expect(siteAdapterFor(onX)).toBeNull();
});

test("the same name again replaces the adapter, and the old undo leaves the new one", () => {
  const first = adapter("test-x", "x.com");
  const second = adapter("test-x", "x.com");
  const undoFirst = registerSiteAdapter(first);
  const undoSecond = registerSiteAdapter(second);
  try {
    expect(siteAdapterFor(onX)).toBe(second);
    undoFirst();
    expect(siteAdapterFor(onX)).toBe(second);
  } finally {
    undoSecond();
  }
  expect(siteAdapterFor(onX)).toBeNull();
});

test("of two adapters that claim the same material, the first registered takes it", () => {
  const undoA = registerSiteAdapter(adapter("test-a", "x.com"));
  const undoB = registerSiteAdapter(adapter("test-b", "x.com"));
  try {
    expect(siteAdapterFor(onX)?.name).toBe("test-a");
  } finally {
    undoA();
    undoB();
  }
});

test("materialUrl reads the link of every kind that has one", () => {
  expect(materialUrl({ kind: "web", url: "https://e.com/p", html: "" })?.pathname).toBe("/p");
  expect(materialUrl({ kind: "text", text: "", sourceUrl: "https://e.com/q" })?.pathname).toBe("/q");
  expect(materialUrl({ kind: "markdown", markdown: "" })).toBeNull();
  expect(materialUrl({ kind: "url", url: "not a url" })).toBeNull();
});
