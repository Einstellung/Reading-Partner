// The Settings dropdown's label association, pinned by a static render, beside
// the other shadcn contracts (primitive-contract, dialog-contract).
//
// What it proves: the rendered trigger is not inside a <label>, and the label
// still names it — by htmlFor and by aria-label. A <label> around a <button>
// makes the button its labeled control, and the browser then forwards a
// synthetic click to it for clicks that land in the label but outside the
// button; Radix's Select opens on click for a finger (docs/pitfall/92), so that
// is a second open on touch (radix-ui/primitives#3679).
//
// What it does not prove: that a tap opens the list on iOS. jsdom has no tap and
// no WebKit, and the report this came from (iPad, 0.8.16) was never reproduced
// off the device.
//
// Run: bun test.

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { useDom } from "../../support/dom";

// The field comes in after the window. It builds on Radix's Select, which
// reaches for a portal, and that pulls react-dom's client bundle, which decides
// at module evaluation whether it is in a browser and never reconsiders
// (docs/pitfall/121). Static imports are evaluated before any top-level await,
// so importing it the ordinary way evaluates that bundle with no window in
// scope and every useDom() in the run then throws — harmless only for as long
// as this file happens to run late (docs/pitfall/175). Nothing below needs a
// DOM; the window is here so react-dom's feature detection lands where it would
// have landed if this file had never run.
await useDom();

const { ChoiceField } = await import("../../../src/ui/components/settings/ChoiceField");

const markup = renderToStaticMarkup(
  <ChoiceField
    label="Language"
    value="en"
    choices={[
      { value: "en", label: "English" },
      { value: "zh", label: "Chinese" },
    ]}
    onChange={() => {}}
  />,
);

function labelBlock(html: string): string {
  const start = html.indexOf("<label");
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf("</label>", start);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

test("the select trigger is not a descendant of the label", () => {
  expect(labelBlock(markup)).not.toContain('data-slot="select-trigger"');
});

test("the label points at the trigger and the trigger carries its id", () => {
  const forId = /<label[^>]*\sfor="([^"]+)"/.exec(markup)?.[1];
  expect(forId).toBeTruthy();
  const triggerId = /<button[^>]*\bdata-slot="select-trigger"[^>]*/
    .exec(markup)?.[0]
    .match(/\sid="([^"]+)"/)?.[1];
  expect(triggerId).toBe(forId!);
});

test("the trigger keeps its own name", () => {
  expect(markup).toContain('aria-label="Language"');
});
