// The briefing card's lines (HomeCard.tsx), minus React.

import type { Briefing } from "../../../info/boxes/types";
import { briefingCovers, isEmptyDay, nothingChangedLine } from "./briefing-view";
import { formatDateTime, t } from "../../../i18n";

// When the briefing was built, in local time. A reader can be looking at one
// made hours ago on another machine, or — after midnight, or in another timezone
// — at yesterday's, which is the right thing to show as long as it says so.
export function builtAt(generatedAt: number, now: Date = new Date()): string {
  const at = new Date(generatedAt);
  const time = formatDateTime(at, { hour: "2-digit", minute: "2-digit" });
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  return sameDay ? time : `${formatDateTime(at)} ${time}`;
}

// The briefing card's eyebrow.
export function briefingEyebrow(briefing: Briefing | null, now: Date = new Date()): string {
  return briefing
    ? t("info.today.briefingEyebrowBuilt", { time: builtAt(briefing.generatedAt, now) })
    : t("info.today.briefingEyebrow");
}

// What the card says the day was: the covers of the labs that changed, cut to
// the two the card has room for.
export function briefingCardBody(briefing: Briefing): string {
  if (isEmptyDay(briefing)) return nothingChangedLine();
  const covers = briefingCovers(briefing);
  const shown = covers.slice(0, TODAY_CARD_COVERS).map((c) => c.cover);
  return covers.length > TODAY_CARD_COVERS ? `${shown.join(" ")} …` : shown.join(" ");
}

// The line under the card's body: how much of the day is behind the card. How
// many labs moved, and how much of what they found is worth opening — the
// one-liners are read on the card's own page, and what the day discarded is
// nobody's business (docs/63).
export function briefingFooterLine(briefing: Briefing): string {
  const worth = t("info.today.worthReading", { count: briefing.mustRead.length + briefing.outOfLane.length });
  const labs = t("info.today.labsChanged", { count: briefingCovers(briefing).length });
  return isEmptyDay(briefing) ? labs : `${labs} · ${worth}`;
}

// How many of the day's picks the card shows before the footer takes over, and
// how many lab covers fit above them.
export const TODAY_CARD_ITEMS = 2;
export const TODAY_CARD_COVERS = 2;
