// The phone shell's answer to the keyboard (docs/pitfall/443). WKWebView scrolls
// the document up by the keyboard's height instead of shrinking the page, which
// took every top bar off screen. While a keyboard is up the shell moves to the
// top of what is still visible and keeps its size, so nothing in it is laid out
// again — the reader a lesson covers keeps its column (a shell that shrank to
// the visible part took the EPUB reader under the lesson with it, and the
// second keyboard over that lesson ended in React's update-depth error) — and
// the chat that owns the field pads itself by what the keyboard covers, which
// the context carries (CallView).
//
// `top`, not a transform, so the shell never becomes the containing block of
// the fixed overlays inside it.

import type { ReactNode } from "react";
import { useRef } from "react";
import { ShellKeyboardContext, useKeyboardFrame } from "../common/useKeyboardInset";

export function KeyboardShell({ className, children }: { className: string; children: ReactNode }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const keyboard = useKeyboardFrame(shellRef);
  return (
    <ShellKeyboardContext.Provider value={keyboard?.covered ?? 0}>
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
