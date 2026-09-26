// The shells' answer to the keyboard (docs/pitfall/443), the phone's and the
// iPad's alike. WKWebView scrolls the document up by the keyboard's height
// instead of shrinking the page — the iPhone always, the iPad until the app is
// first switched away from — which took every top bar off screen. While a keyboard is up the shell moves to the
// top of what is still visible and keeps its size, so nothing in it is laid out
// again — the reader a lesson covers keeps its column (a shell that shrank to
// the visible part took the EPUB reader under the lesson with it, and the
// second keyboard over that lesson ended in React's update-depth error) — and
// the chat that owns the field pads itself by what the keyboard covers, which
// the context carries (useKeyboardRoom). The same context carries the covered
// height of an iPad that shrinks only the visual viewport (docs/pitfall/392):
// there the shell stays where it is. With no keyboard (a desktop) nothing moves.
//
// `top`, not a transform, so the shell never becomes the containing block of
// the fixed overlays inside it; `className` has to position the shell for it.

import type { ReactNode } from "react";
import { useRef } from "react";
import { NO_KEYBOARD, ShellKeyboardContext, useKeyboardFrame } from "./useKeyboardInset";

export function KeyboardShell({ className, children }: { className: string; children: ReactNode }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const keyboard = useKeyboardFrame(shellRef);
  return (
    <ShellKeyboardContext.Provider value={keyboard ?? NO_KEYBOARD}>
      {/* The moved shell hangs past the bottom of the page. Clipped here, or that
          overhang would lengthen the document and hand WKWebView more to scroll,
          which moves the shell again. `clip`, not `hidden`: a box that hides its
          overflow is still a scroller, and revealing the field would scroll it. */}
      <div className="h-full overflow-clip">
        <div ref={shellRef} className={className} style={keyboard ? { top: keyboard.top } : undefined}>
          {children}
        </div>
      </div>
    </ShellKeyboardContext.Provider>
  );
}
