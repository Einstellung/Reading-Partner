// Card components declare intent through dispatch, never touch the host directly.
// These pin the action each card raises. The hookless cards (probe-confirm,
// briefing-ready, briefing-failed) are invoked as plain functions and their
// element tree is walked for the button, whose onClick is fired to capture the
// dispatched action — no DOM needed. Run: bun test.

import { expect, test } from "bun:test";
import type { ReactElement } from "react";
import { BriefingFailedCard, BriefingReadyCard, ProbeConfirmCard } from "../../src/components/InfoCards";
import type { CardAction } from "../../src/components/chatParts";
import type {
  BriefingFailedCardData,
  BriefingReadyCardData,
  ProbeConfirmCardData,
} from "../../src/info/cards";

// Walk a React element tree collecting every <button> that has an onClick.
function buttons(node: unknown, out: { props: Record<string, any> }[] = []): { props: Record<string, any> }[] {
  if (Array.isArray(node)) {
    for (const c of node) buttons(c, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const el = node as { type?: unknown; props?: Record<string, any> };
  if (el.type === "button" && el.props?.onClick) out.push({ props: el.props });
  if (el.props && "children" in el.props) buttons(el.props.children, out);
  return out;
}

const descriptor = { id: "s1", name: "Example", enabled: true } as ProbeConfirmCardData["descriptor"];

test("ProbeConfirmCard Add dispatches mutate:add-source", () => {
  let action: CardAction | undefined;
  const payload: ProbeConfirmCardData = { kind: "probe-confirm", descriptor, pipeLabel: "RSS", samples: [] };
  const el = ProbeConfirmCard({ payload, surface: "call", dispatch: (a) => (action = a) }) as ReactElement;
  buttons(el)[0].props.onClick();
  expect(action).toEqual({ kind: "mutate", op: "add-source" });
});

test("an already-added ProbeConfirmCard shows no Add button", () => {
  const payload: ProbeConfirmCardData = { kind: "probe-confirm", descriptor, pipeLabel: "RSS", samples: [], added: true };
  const el = ProbeConfirmCard({ payload, surface: "call", dispatch: () => {} }) as ReactElement;
  expect(buttons(el)).toHaveLength(0);
});

test("BriefingReadyCard dispatches navigate:briefing with the date", () => {
  let action: CardAction | undefined;
  const payload: BriefingReadyCardData = { kind: "briefing-ready", date: "2026-07-22", worth: 3, oneLiners: 1, filtered: 2 };
  const el = BriefingReadyCard({ payload, surface: "call", dispatch: (a) => (action = a) }) as ReactElement;
  buttons(el)[0].props.onClick();
  expect(action).toEqual({ kind: "navigate", to: "briefing", arg: "2026-07-22" });
});

test("BriefingFailedCard Try again dispatches mutate:retry-briefing", () => {
  let action: CardAction | undefined;
  const payload: BriefingFailedCardData = { kind: "briefing-failed", message: "no network" };
  const el = BriefingFailedCard({ payload, surface: "call", dispatch: (a) => (action = a) }) as ReactElement;
  buttons(el)[0].props.onClick();
  expect(action).toEqual({ kind: "mutate", op: "retry-briefing" });
});
