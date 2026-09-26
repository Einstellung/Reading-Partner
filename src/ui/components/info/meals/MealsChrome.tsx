// The chrome the three meals screens share (docs/73): the column they are drawn
// in, the bar at the top of each, and the line TheMealDB's terms ask for.
//
// Rendering only. Nothing here decides anything — what a screen is called and
// what its Ask button says are the caller's, because the caller is the one that
// knows which day it is looking at.

import { openExternal } from "../../../../platform/app/external-link";
import { Button } from "../../ui/button";
import { IconSparkle } from "../../base/icons";
import { cn } from "../../lib/utils";
import type { MealCells } from "../../../../info/meals/nutrition/solve";
import { cellMarks, cellsAriaLabel } from "../../../../info/meals/screen/screen-lines";
import type { TargetsSummary } from "../../../../info/meals/screen/view";

/** The one column all three screens are drawn in: phone width, centred wider. */
export function MealsColumn({ children }: { children: React.ReactNode }) {
  // No padding above: the bar below is sticky, and a band of page above it is a
  // band the cards scroll through in full view before the blur catches them.
  // The bar carries that space itself instead.
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-5 sm:px-6 sm:pb-8">
      {children}
    </div>
  );
}

function BackArrow() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

/**
 * The bar at the top of a meals screen: where it came from, what it is, and the
 * one button that opens the conversation about it.
 *
 * The Ask label changes with the screen — "Ask about shopping", "Ask about
 * Thursday" — because the thread is one standing conversation and the label is
 * the only thing that says which part of it the reader is about to talk about.
 */
export function MealsHeader({
  title,
  weekday,
  askLabel,
  onAsk,
  onBack,
}: {
  title: string;
  // Beside the title when the title is not already a weekday ("Today Monday").
  weekday?: string | null;
  // Left out on the onboarding thread, which is a conversation of its own.
  askLabel?: string;
  onAsk?: () => void;
  onBack?: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-2 border-b border-border-subtle bg-background/85 px-4 pb-1.5 pt-3 backdrop-blur sm:-mx-6 sm:mb-6 sm:gap-3 sm:px-6 sm:pb-2 sm:pt-5">
      {onBack && (
        <button
          type="button"
          aria-label="Back"
          className="-ml-2 flex h-11 w-9 flex-none items-center justify-center text-muted-foreground can-hover:hover:text-foreground"
          onClick={onBack}
        >
          <BackArrow />
        </button>
      )}
      <span className="min-w-0 truncate font-display text-[17px] font-semibold text-foreground">
        {title}
      </span>
      {weekday && <span className="flex-none text-[13px] text-faint-foreground">{weekday}</span>}
      <span className="flex-1" />
      {askLabel && onAsk && (
        <Button variant="secondary" size="chip" onClick={onAsk} title={askLabel}>
          <IconSparkle size={14} /> <span className="whitespace-nowrap">{askLabel}</span>
        </Button>
      )}
    </div>
  );
}

/**
 * TheMealDB's terms ask for a link back wherever their artwork is used, and
 * every ingredient picture in this line is theirs. One line, at the foot of
 * each of the three screens, opened in the system browser like every other
 * outbound link.
 */
export function PhotoCredit() {
  return (
    <p className="mt-8 text-[11px] leading-snug text-faint-foreground">
      Ingredient photos from{" "}
      <button
        type="button"
        className="underline underline-offset-2 can-hover:hover:text-muted-foreground"
        onClick={() => openExternal("https://www.themealdb.com")}
      >
        TheMealDB
      </button>
    </p>
  );
}

/** The chevron a row that opens something carries. */
export function Chevron() {
  return (
    <span aria-hidden="true" className="flex-none text-[17px] leading-none text-muted-strong">
      ›
    </span>
  );
}

/** "Training day" or "Rest day", as a pill; training in the accent. */
export function DayKindTag({ training, short }: { training: boolean; short?: boolean }) {
  const word = short ? (training ? "Training" : "Rest") : training ? "Training day" : "Rest day";
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border bg-background px-2 text-[12px] leading-[18px]",
        training ? "border-accent-line text-accent-line" : "border-border text-faint-foreground",
      )}
    >
      {word}
    </span>
  );
}

/** The three squares a meal carries: protein, veg, carbs, filled when met. */
export function Cells({ cells, big }: { cells: MealCells; big?: boolean }) {
  return (
    <span className="inline-flex flex-none gap-[3px]" aria-label={cellsAriaLabel(cells)} role="img">
      {cellMarks(cells).map((c) => (
        <i
          key={c.short}
          aria-hidden="true"
          className={cn(
            "rounded-[4px] text-center not-italic",
            big ? "h-[22px] px-2 text-[12px] leading-[20px]" : "h-[18px] min-w-[18px] px-1 text-[10px] leading-[16px]",
            c.on
              ? "border border-primary bg-primary text-primary-foreground"
              : "border border-dashed border-secondary-border text-faint-foreground",
          )}
        >
          {big ? c.long : c.short}
        </i>
      ))}
    </span>
  );
}

/** A small accent link inside a card: "How it's calculated ›". */
export function CardLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <Button variant="link" size="link" className="text-[13px] text-accent-line" onClick={onClick}>
      {children}
    </Button>
  );
}

/** The small uppercase label a card's corners carry. */
export function CardLabel({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className={cn(
        "text-[11px] font-medium uppercase tracking-wider",
        accent ? "text-accent-line" : "text-faint-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** Daily targets: training and rest side by side, the week in one line, the way to the method. */
export function TargetsCard({
  summary,
  onMethod,
}: {
  summary: TargetsSummary;
  onMethod?: () => void;
}) {
  const rows: { label: string; key: "kcal" | "protein" | "fat" | "carbs"; unit: string; big?: boolean }[] = [
    { label: "Calories", key: "kcal", unit: "kcal", big: true },
    { label: "Protein", key: "protein", unit: "g" },
    { label: "Fat", key: "fat", unit: "g" },
    { label: "Carbs", key: "carbs", unit: "g" },
  ];
  return (
    <section className="rounded-2xl border border-border-soft bg-card p-5">
      <div className="flex items-baseline gap-2">
        <CardLabel>Daily targets</CardLabel>
        <span className="flex-1" />
        <CardLabel accent>{summary.goal}</CardLabel>
      </div>
      <table className="mt-2.5 w-full border-collapse tabular-nums">
        <thead>
          <tr>
            <th />
            {summary.columns.map((c) => (
              <th key={c.kind} className="pb-1.5 text-right text-[12px] font-normal text-faint-foreground">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border-subtle">
              <td className="py-[7px] text-left text-[14px] text-muted-foreground">{r.label}</td>
              {summary.columns.map((c) => (
                <td key={c.kind} className="py-[7px] text-right text-[14px] text-foreground">
                  <span className={r.big ? "font-display text-[19px]" : undefined}>{c[r.key]}</span>{" "}
                  <span className="text-[12px] text-faint-foreground">{r.unit}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="m-0 mt-2.5 text-[13px] leading-relaxed text-muted-foreground">{summary.line}</p>
      {summary.warning && (
        <p className="m-0 mt-2 text-[13px] leading-relaxed text-destructive">{summary.warning}</p>
      )}
      {onMethod && (
        <div className="mt-2">
          <CardLink onClick={onMethod}>How it's calculated ›</CardLink>
        </div>
      )}
    </section>
  );
}
