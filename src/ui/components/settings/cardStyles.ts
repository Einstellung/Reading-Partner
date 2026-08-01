// The card and field chrome every settings card is built from.

export const CARD = "rounded-xl border border-[#dcdcdc] p-4 flex flex-col gap-3";
// `[font:inherit]` wins over `text-sm` (arbitrary properties sort after the
// utility), so a field takes its size from the label around it — 14px. The
// `coarse:` variant sorts after both and pins 16px on a touch pointer, below
// which WKWebView zooms the page in on focus.
export const FIELD =
  "flex-1 min-w-0 px-2.5 py-2 border border-[#dcdcdc] rounded-md [font:inherit] text-sm coarse:text-base";
