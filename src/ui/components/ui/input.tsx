// shadcn/ui Input over the app's own field chrome (what settings/cardStyles.ts
// called FIELD).
//
// `coarse:text-base` is not cosmetic: WKWebView zooms the whole page in when a
// focused field is under 16px, and there is no way back out of that zoom.
//
// `flex-1 min-w-0` rather than shadcn's `w-full`: every field here sits in a
// flex row next to its button, and min-w-0 is what stops a long value from
// pushing the row wider than the card.
import type * as React from "react";

import { cn } from "@/ui/components/lib/utils";

// Exported because <select> wears the same chrome and has no primitive yet
// (Select lands in the fifth pass, docs/30). One string, so the two cannot drift.
const inputClassName =
  "min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-2 text-sm coarse:text-base";

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input" className={cn(inputClassName, className)} {...props} />;
}

export { Input, inputClassName };
