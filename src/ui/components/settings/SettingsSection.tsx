// One group of settings cards: its heading and the cards under it. One place,
// so the three panels cannot drift in the weight of a heading or in the gap
// between two cards of the same group.
//
// The spacing is a ladder, and it is what tells a group from a run of cards: 8px
// between the cards of a group, 12px between the rows inside a card, 16px of
// card padding, 28px between groups — the last of those is the panel's own flex
// column, not a margin here, so a section never has to know what precedes it.

export function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mt-0 mb-2 text-sm font-semibold text-[#666]">{title}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

// The column a panel's sections stand in. The gap between two groups is written
// here rather than on each heading.
export const SETTINGS_PANEL = "flex flex-col gap-7";
