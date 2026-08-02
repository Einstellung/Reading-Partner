// The header's Settings entry. Carries a dot when something in Settings needs
// looking at — today only a sync that is not running (platform/sync/health).
// The same idea as the reader sidebar's background-work dot: state rides on the
// affordance that leads to it, instead of a banner that has to be dismissed.

import { Button } from "../ui/button";

export default function SettingsButton({
  alert,
  onClick,
}: {
  alert: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      className="relative coarse:min-w-[44px]"
      title={alert ? "Settings — sync needs attention" : "Settings"}
      aria-label={alert ? "Settings — sync needs attention" : "Settings"}
      onClick={onClick}
    >
      ⚙
      {alert && (
        <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-[#b45309] ring-2 ring-[#fafafa]" />
      )}
    </Button>
  );
}
