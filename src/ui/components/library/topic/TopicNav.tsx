// A topic's sections as a row of tabs under its name (docs/51): Materials,
// Retell, Rehearsal, AI observations. The left column belongs to the shell now,
// so the sections went horizontal — a topic is one place, and its four views are
// tabs of it rather than a second sidebar beside the first.
//
// Plain buttons rather than shadcn's Tabs: the panel a tab shows is not under
// the row in the DOM. It is in the topic's scrolling column, below a header that
// does not scroll, and a Radix Tabs root that wraps only its own list points
// every trigger at a panel that is not there.
//
// Pure and controlled: which section is showing belongs to the host
// (LibraryScreen), which is also where it is remembered.

import { IconBooks, IconObservations, IconRehearse, IconRetell } from "../../base/icons";
import { useT } from "../../../../i18n";
import { Button } from "../../ui/button";
import { TOPIC_SECTIONS, type TopicSection } from "../../base/topic-nav";

const ICONS: Record<TopicSection, (p: { size?: number }) => JSX.Element> = {
  materials: IconBooks,
  retell: IconRetell,
  rehearsal: IconRehearse,
  observations: IconObservations,
};

// h-11 is the 44px touch target; the underline is the tab, so the row carries no
// fill and nothing moves when the active one changes.
const TAB =
  "h-11 flex-none gap-2 rounded-none border-b-2 border-transparent px-3 text-[14px] " +
  "font-medium text-muted-foreground";
const TAB_ACTIVE = "border-accent-line text-foreground";

type SectionLabelKey =
  | "library.section.materials"
  | "library.section.retell"
  | "library.section.rehearsal"
  | "library.section.observations";

const SECTION_LABEL_KEY: Record<TopicSection, SectionLabelKey> = {
  materials: "library.section.materials",
  retell: "library.section.retell",
  rehearsal: "library.section.rehearsal",
  observations: "library.section.observations",
};

export default function TopicNav(props: {
  section: TopicSection;
  onSelect: (section: TopicSection) => void;
}) {
  const t = useT();
  return (
    // Scrolls within its own band on a narrow window rather than wrapping to a
    // second line, which would move everything under it.
    <nav aria-label={t("library.section.navLabel")} className="-mb-px flex gap-0.5 overflow-x-auto">
      {TOPIC_SECTIONS.map(({ id }) => {
        const Icon = ICONS[id];
        const label = t(SECTION_LABEL_KEY[id]);
        const active = props.section === id;
        return (
          <Button
            key={id}
            type="button"
            variant="ghost"
            size={null}
            className={`${TAB}${active ? ` ${TAB_ACTIVE}` : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => props.onSelect(id)}
          >
            <Icon size={16} />
            <span className="whitespace-nowrap">{label}</span>
          </Button>
        );
      })}
    </nav>
  );
}
