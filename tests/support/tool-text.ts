// The model-facing text of a tool result, for tests that assert on what a tool
// says. A write returns { text, receipt } now (legion/durable/contract.ts), so a
// test that treated the result as a string would be asserting on an object.

import type { ToolResult } from "../../src/legion/durable/contract";

export function toolText(raw: string | ToolResult): string {
  return typeof raw === "string" ? raw : raw.text;
}

// The receipt a write reported, for tests that check the gate held.
export function toolReceipt(raw: string | ToolResult): ToolResult["receipt"] {
  return typeof raw === "string" ? undefined : raw.receipt;
}
