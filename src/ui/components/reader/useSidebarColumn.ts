// Which form the reader's left panel has, as one boolean React can render from.
// The rule and the storage are in sidebar-column.ts; this is only the
// subscription to the media query, so a rotation or a Split View drag moves the
// panel between drawer and column without a reload.

import { useEffect, useState } from "react";
import { COLUMN_MEDIA_QUERY, columnLayoutNow } from "./sidebar-column";

function browserWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

export function useSidebarColumn(): boolean {
  const [column, setColumn] = useState(() => columnLayoutNow(browserWindow()));
  useEffect(() => {
    const win = browserWindow();
    const mql = win?.matchMedia?.(COLUMN_MEDIA_QUERY);
    if (!mql) return;
    const onChange = () => setColumn(mql.matches);
    // Read once on subscribe: between the first render and this effect the
    // window can already have been resized, and a listener only reports changes
    // it was there for.
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return column;
}
