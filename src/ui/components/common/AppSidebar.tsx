// The tablet/desktop shell's left sidebar (docs/51): Today, Briefing, Topics,
// and Settings pinned at the bottom. It is a column in the flow, not an overlay
// — the content narrows beside it, so nothing is covered and none of the overlay
// rules (docs/30) apply.
//
// Two widths, chosen by the breakpoint and not by a stored preference: a 52px
// icon rail below `lg` (a portrait iPad, where 176px of labels costs the shelf a
// card) and the labelled column at or above it. A rail rather than a drawer,
// because the three destinations have to stay one tap away on a tablet.
//
// Which item is lit and where each one goes are in base/shell-nav.ts; this file
// renders them and binds the events.

import { IconBriefing, IconBooks, IconGear, IconToday } from "../base/icons";
import { SHELL_NAV_ITEMS, type ShellNavId } from "../base/shell-nav";
import { Button } from "../ui/button";

const ICONS: Record<ShellNavId, (p: { size?: number }) => JSX.Element> = {
  today: IconToday,
  briefing: IconBriefing,
  topics: IconBooks,
  settings: IconGear,
};

// One row, in both widths. h-11 is the 44px touch target either way; the rail is
// 44 wide and grows to the full column at `lg`, where the label joins it. The
// active row takes the neutral chip fill the reader's panels use, so every
// sidebar in the app reads alike. Depth and a medium label, not a hue.
const ROW =
  "h-11 w-11 flex-none justify-center rounded-md px-0 text-muted-foreground " +
  "lg:w-full lg:justify-start lg:gap-2.5 lg:px-3";
const ROW_ACTIVE = "bg-secondary text-secondary-foreground can-hover:hover:bg-secondary";
const LABEL = "hidden truncate text-[14px] font-medium lg:inline";

function Row(props: {
  label: string;
  icon: (p: { size?: number }) => JSX.Element;
  active?: boolean;
  title?: string;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  const Icon = props.icon;
  return (
    <Button
      type="button"
      variant="ghost"
      size={null}
      className={`relative ${ROW}${props.active ? ` ${ROW_ACTIVE}` : ""}`}
      // The title is the label a rail cannot show. It never fires on touch,
      // which is what aria-label is for.
      title={props.title ?? props.label}
      aria-label={props.title ?? props.label}
      aria-current={props.active ? "page" : undefined}
      onClick={props.onClick}
    >
      <Icon size={20} />
      <span className={LABEL}>{props.label}</span>
      {props.children}
    </Button>
  );
}

export default function AppSidebar(props: {
  // Null draws no lit row: a screen the sidebar does not name.
  active: ShellNavId | null;
  onSelect: (id: ShellNavId) => void;
  onOpenSettings: () => void;
  // Something in Settings needs looking at — today only a sync that is not
  // running (platform/sync/health). The state rides on the affordance that
  // leads to it, the same as the header's Settings button did.
  settingsAlert: boolean;
}) {
  return (
    <nav
      aria-label="Sections"
      // Plain padding, not the `-safe-*` utilities: the shell already wears
      // `p-safe` (App.tsx), and a rail whose gutters grow with the inset stops
      // holding its 44px button. 52px is that button plus the two 4px gutters.
      className={
        "flex w-[3.25rem] flex-none flex-col items-center gap-0.5 overflow-y-auto " +
        "border-r border-border bg-muted-faint px-1 py-4 lg:w-44 lg:items-stretch lg:px-2"
      }
    >
      <div className="hidden px-3 pb-3 text-[13px] font-semibold text-foreground lg:block">
        Reading Partner
      </div>

      {SHELL_NAV_ITEMS.map((item) => (
        <Row
          key={item.id}
          label={item.label}
          icon={ICONS[item.id]}
          active={props.active === item.id}
          onClick={() => props.onSelect(item.id)}
        />
      ))}

      <span className="flex-1" />

      <Row
        label="Settings"
        icon={ICONS.settings}
        active={props.active === "settings"}
        title={props.settingsAlert ? "Settings — sync needs attention" : "Settings"}
        onClick={props.onOpenSettings}
      >
        {props.settingsAlert && (
          <span className="absolute left-6 top-2 h-2 w-2 rounded-full bg-[#b45309] ring-2 ring-muted-faint" />
        )}
      </Row>
    </nav>
  );
}
