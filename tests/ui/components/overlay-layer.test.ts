// The count that tells the app's own click-outside overlays to stand down while
// a portalled layer is up. What has to hold: it nests, it never goes negative,
// and a release cannot be spent twice — a leak here leaves CallBubble unable to
// close for the rest of the session.

import { beforeEach, expect, test } from "bun:test";
import {
  overlayLayerOpen,
  pushOverlayLayer,
  resetOverlayLayers,
} from "../../../src/ui/components/common/overlay-layer";

beforeEach(resetOverlayLayers);

test("no layer open by default", () => {
  expect(overlayLayerOpen()).toBe(false);
});

test("a layer is open until its release runs", () => {
  const release = pushOverlayLayer();
  expect(overlayLayerOpen()).toBe(true);
  release();
  expect(overlayLayerOpen()).toBe(false);
});

test("nested layers: the outer one keeps it open", () => {
  const outer = pushOverlayLayer();
  const inner = pushOverlayLayer();
  inner();
  expect(overlayLayerOpen()).toBe(true);
  outer();
  expect(overlayLayerOpen()).toBe(false);
});

test("a release is spent once, so it cannot close a layer it does not own", () => {
  const first = pushOverlayLayer();
  first();
  first();
  const second = pushOverlayLayer();
  expect(overlayLayerOpen()).toBe(true);
  second();
  expect(overlayLayerOpen()).toBe(false);
});

test("releases out of order still land on zero", () => {
  const a = pushOverlayLayer();
  const b = pushOverlayLayer();
  a();
  b();
  expect(overlayLayerOpen()).toBe(false);
});
