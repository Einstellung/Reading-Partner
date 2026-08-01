// The card and field chrome every settings card is built from.

export const CARD = "rounded-xl border border-[#dcdcdc] p-4 flex flex-col gap-3";
// Preflight gives every control `font: inherit`, so the field takes the app
// font family and `text-sm` is the size that actually applies — 14px in every
// card. `coarse:` pins 16px on a touch pointer, below which WKWebView zooms the
// page in on focus. `bg-white` is explicit because preflight clears the UA fill.
export const FIELD =
  "flex-1 min-w-0 px-2.5 py-2 border border-[#dcdcdc] rounded-md bg-white text-sm coarse:text-base";
