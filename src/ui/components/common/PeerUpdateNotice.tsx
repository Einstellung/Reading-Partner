// One line on the home screen when a desktop is on an older build than this
// phone or iPad (usePeerUpdateNotice.ts). Renders nothing on a desktop or when
// there is nothing to say.

import { IconClose } from "../base/icons";
import { Button } from "../ui/button";
import { peerUpdateText } from "./peer-update";
import { usePeerUpdateNotice } from "./usePeerUpdateNotice";

export default function PeerUpdateNotice({ className = "" }: { className?: string }) {
  const { notice, dismiss } = usePeerUpdateNotice();
  if (!notice) return null;
  return (
    <div
      role="status"
      className={`flex items-center gap-2 rounded-xl border border-border-soft bg-muted-soft py-1 pl-4 pr-1 ${className}`}
    >
      <p className="m-0 min-w-0 flex-1 py-1.5 text-[13px] leading-snug text-muted-foreground">
        {peerUpdateText(notice)}
      </p>
      <Button variant="ghost" size="icon" aria-label="Dismiss" title="Dismiss" onClick={dismiss}>
        <IconClose size={12} />
      </Button>
    </div>
  );
}
