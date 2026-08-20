// The topic sidebar (docs/31, "界面"): Materials, Talks, AI observations down the
// left of a topic, above the shelf rather than inside a book.
//
// It is a column in the flow, not an overlay: it sits beside the content and the
// content narrows, so nothing is covered and none of the overlay rules (docs/30)
// apply. Collapsed it becomes an icon rail rather than disappearing — on a
// portrait iPad the sidebar has to stay reachable, and 52px is cheaper than a
// drawer plus a button to summon it.
//
// Pure and controlled: which section is showing and whether it is open belong to
// the host (LibraryScreen), which is also where they are remembered.

import { IconBooks, IconObservations, IconSidebar, IconTalk } from "../../base/icons";
import { Button } from "../../ui/button";
import { TOPIC_SECTIONS, type TopicSection } from "../../base/topic-nav";

const ICONS: Record<TopicSection, (p: { size?: number }) => JSX.Element> = {
  materials: IconBooks,
  talks: IconTalk,
  observations: IconObservations,
};

// One row, in each of the sidebar's two widths. Written out twice rather than
// as a base plus overrides: two utilities that set the same property are settled
// by the order Tailwind emits them in, not by the order they are concatenated in
// (docs/30). h-11 is the 44px touch target either way; the active row takes the
// same accent fill the reader's tabs use, so the two sidebars read alike.
const ROW = "h-11 w-full justify-start gap-2.5 rounded-md px-2.5 text-muted-foreground";
const ROW_RAIL = "h-11 w-11 justify-center rounded-md text-muted-foreground";
const ROW_ACTIVE = "bg-accent text-accent-foreground can-hover:hover:bg-accent";

export default function TopicNav(props: {
  section: TopicSection;
  onSelect: (section: TopicSection) => void;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <nav
      aria-label="Topic"
      className={
        // Plain padding, not the `-safe-*` utilities: the shell already wears
        // `p-safe` (App.tsx), and a rail whose gutters grow with the inset stops
        // holding its 44px button. 3.75rem minus the two 0.5rem gutters is that
        // button exactly.
        "flex flex-none flex-col gap-1 overflow-y-auto border-r border-border bg-background px-2 py-4 " +
        (props.open ? "w-[13rem]" : "w-[3.75rem] items-center")
      }
    >
      <Button
        type="button"
        variant="ghost"
        size={null}
        className="h-11 w-11 flex-none justify-center rounded-md text-muted-foreground"
        title={props.open ? "Collapse sidebar" : "Expand sidebar"}
        aria-label={props.open ? "Collapse sidebar" : "Expand sidebar"}
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        <IconSidebar size={18} />
      </Button>

      {TOPIC_SECTIONS.map(({ id, label }) => {
        const Icon = ICONS[id];
        const active = props.section === id;
        return (
          <Button
            key={id}
            type="button"
            variant="ghost"
            size={null}
            className={(props.open ? ROW : ROW_RAIL) + (active ? ` ${ROW_ACTIVE}` : "")}
            // The title is the label a collapsed rail cannot show. It never fires
            // on touch, which is what aria-label is for.
            title={label}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            onClick={() => props.onSelect(id)}
          >
            <Icon size={18} />
            {props.open && <span className="truncate text-[14px] font-medium">{label}</span>}
          </Button>
        );
      })}
    </nav>
  );
}
