// shadcn/ui Textarea on the same chrome as Input. `coarse:text-base` for the
// same reason: under 16px WKWebView zooms the page in on focus.
//
// The chat composer is not one of these. It is a borderless textarea inside the
// pill and is auto-sized by measurement (docs/30 leaves it alone).
import type * as React from "react";

import { cn } from "@/ui/components/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-16 w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm coarse:text-base",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
