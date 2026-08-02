// The phone shell's pull-down-to-ask affordance (docs/22): wrap a screen in it
// and a pull from the top opens the chat that screen's Ask button opens. Only
// the briefing and the article are wrapped — they are the two screens with
// something to talk about.
//
// The child must be a single element and must be the screen's vertical scroll
// container: the hook reads its scrollTop to decide whether a pull may start,
// and moves it to follow the finger.
//
// What comes out of the top says what it is before the finger leaves the glass:
// a chat pill naming the screen, which turns into "Release to ask" the moment
// the pull is far enough to open it. A first accidental pull therefore reads as
// an offer rather than as something that already happened.

import { useMemo } from "react";
import { IconSparkle } from "../common/icons";
import { usePullToAsk } from "./usePullToAsk";

export function PullToAsk({
  label,
  onAsk,
  children,
}: {
  // What the chat would be about, in the reader's words: "Ask about this
  // article". Shown while the pull is still short of the commit distance.
  label: string;
  onAsk: () => void;
  children: React.ReactNode;
}) {
  const { hostRef, stripRef } = usePullToAsk(useMemo(() => ({ onAsk }), [onAsk]));

  return (
    // Clips the screen once it has been pulled down, and holds the strip the
    // pull reveals underneath it.
    <div ref={hostRef} className="absolute inset-0 overflow-hidden">
      <div
        ref={stripRef}
        data-armed="false"
        aria-hidden="true"
        className="group pointer-events-none absolute inset-x-0 top-0 flex h-0 items-end justify-center overflow-hidden bg-[#f4f2fc]"
      >
        <span className="mb-3 flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#c9c2e8] bg-white px-3 py-1.5 text-[13px] text-[#4a3a9e] group-data-[armed=true]:border-primary group-data-[armed=true]:bg-primary group-data-[armed=true]:text-white">
          <IconSparkle size={14} />
          <span className="group-data-[armed=true]:hidden">{label}</span>
          <span className="hidden group-data-[armed=true]:inline">Release to ask</span>
        </span>
      </div>
      {children}
    </div>
  );
}

export default PullToAsk;
