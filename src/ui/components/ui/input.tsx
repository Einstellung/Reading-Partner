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

// The chrome a field wears, shared with the Select trigger (ui/select.tsx) so a
// dropdown and a text box on the same row cannot drift. One string, not two.
// `coarse:min-h-[44px]` is here rather than on the call sites for the same
// reason the button sizes carry theirs: a field is a touch target too, and 42px
// was the last thing in Settings still under the line.
const fieldClassName =
  "min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-2 text-sm coarse:text-base coarse:min-h-[44px]";

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input" className={cn(fieldClassName, className)} {...props} />;
}

export { fieldClassName, Input };
