// The tablet/desktop shell's left sidebar (docs/51): Today, Briefing, Topics,
// and Settings pinned at the bottom. It is a column in the flow, not an overlay
// — the content narrows beside it, so nothing is covered and none of the overlay
// rules (docs/30) apply.
//
// Two widths: a 52px icon rail and a labelled column. Below `lg` (a portrait
// iPad, where the labels cost the shelf a card) it is always the rail; from
// `lg` up the reader picks, and the pick is remembered per device.
//
// Which item is lit and where each one goes are in base/shell-nav.ts; the
// widths, the label rules and the stored choice are in base/shell-sidebar.ts.
// This file renders them and binds the events.

import appIcon from "../../assets/app-icon.png";
import { IconBriefing, IconBooks, IconGear, IconSidebar, IconToday } from "../base/icons";
import { SHELL_NAV_ITEMS, type ShellNavId } from "../base/shell-nav";
import {
  collapseToggleTitle,
  sidebarLabelClass,
  sidebarNameClass,
  sidebarNavClass,
  sidebarRowClass,
  sidebarToggleClass,
  sidebarWordmarkClass,
} from "../base/shell-sidebar";
import { Button } from "../ui/button";

const ICONS: Record<ShellNavId, (p: { size?: number }) => JSX.Element> = {
  today: IconToday,
  briefing: IconBriefing,
  topics: IconBooks,
  settings: IconGear,
};

// The active row takes the neutral chip fill the reader's panels use, so every
// sidebar in the app reads alike. Depth and a medium label, not a hue.
const ROW_ACTIVE = "bg-secondary text-secondary-foreground can-hover:hover:bg-secondary";

function Row(props: {
  label: string;
  icon: (p: { size?: number }) => JSX.Element;
  collapsed: boolean;
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
      className={`relative ${sidebarRowClass(props.collapsed)}${
        props.active ? ` ${ROW_ACTIVE}` : ""
      }`}
      // The title is the label a rail cannot show. It never fires on touch,
      // which is what aria-label is for.
      title={props.title ?? props.label}
      aria-label={props.title ?? props.label}
      aria-current={props.active ? "page" : undefined}
      onClick={props.onClick}
    >
      <Icon size={20} />
      <span className={sidebarLabelClass(props.collapsed)}>{props.label}</span>
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
  // The reader's own choice, stored per device by App.tsx. It only decides
  // anything from `lg` up; below it the class strings resolve to the rail
  // either way.
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const collapsed = props.collapsed;
  const toggle = (
    <Button
      type="button"
      variant="ghost"
      size={null}
      className={sidebarToggleClass(collapsed)}
      title={collapseToggleTitle(collapsed)}
      aria-label={collapseToggleTitle(collapsed)}
      aria-expanded={!collapsed}
      onClick={props.onToggleCollapsed}
    >
      <IconSidebar size={20} />
    </Button>
  );

  return (
    <nav aria-label="Sections" className={sidebarNavClass(collapsed)}>
      <div className={sidebarWordmarkClass(collapsed)}>
        <img
          src={appIcon}
          alt=""
          width={28}
          height={28}
          className="h-7 w-7 flex-none rounded-[7px]"
        />
        <span className={sidebarNameClass(collapsed)}>Reading Partner</span>
        {/* Labelled, the toggle ends the wordmark row. Collapsed, the row has
            room for nothing but the icon, so the toggle drops to the top of the
            rail, under the icon and above the three destinations. */}
        {!collapsed && toggle}
      </div>
      {collapsed && toggle}

      {SHELL_NAV_ITEMS.map((item) => (
        <Row
          key={item.id}
          label={item.label}
          icon={ICONS[item.id]}
          collapsed={collapsed}
          active={props.active === item.id}
          onClick={() => props.onSelect(item.id)}
        />
      ))}

      <span className="flex-1" />

      <Row
        label="Settings"
        icon={ICONS.settings}
        collapsed={collapsed}
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
