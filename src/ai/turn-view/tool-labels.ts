// Pieces of a tool's reader-facing label that more than one domain mount needs.
// Here rather than inside reading/ because the mounts that share them sit in
// different subtrees of it, and a shared file inside one of them is a cycle.

import { t } from "../../i18n";

// "Reading page 7" / "Reading pages 41–44". Called with {} by the contract test,
// so a call with no range still has to read as a sentence.
export function pageRangeLabel(args: Record<string, any>): string {
  const from = Number(args.from);
  const to = Number(args.to);
  if (!Number.isFinite(from) && !Number.isFinite(to)) return t("chat.toolLabel.readingThePages");
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return lo === hi
    ? t("chat.toolLabel.readingPage", { page: lo })
    : t("chat.toolLabel.readingPages", { from: lo, to: hi });
}
