// The heading over a group of settings cards. One place, so the three panels
// cannot drift in weight, colour, or the gap above a group.
//
// `first` drops the top margin: the first heading in a panel sits against the
// tab strip, not under a card.

import { cn } from "../lib/utils";

export function SectionHeading({
  first,
  children,
}: {
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <h2 className={cn("mb-2 text-sm font-semibold text-[#777]", first ? "mt-0" : "mt-8")}>
      {children}
    </h2>
  );
}
