// The chrome the three meals screens share (docs/73): the column they are drawn
// in, the bar at the top of each, and the line TheMealDB's terms ask for.
//
// Rendering only. Nothing here decides anything — what a screen is called and
// what its Ask button says are the caller's, because the caller is the one that
// knows which day it is looking at.

import { openExternal } from "../../../platform/app/external-link";
import { Button } from "../ui/button";
import { IconSparkle } from "../base/icons";

/** The one column all three screens are drawn in: phone width, centred wider. */
export function MealsColumn({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-4 py-5 sm:px-6 sm:py-8">
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
  askLabel: string;
  onAsk: () => void;
  onBack?: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-2 border-b border-border-subtle bg-background/85 px-4 py-1.5 backdrop-blur sm:-mx-6 sm:mb-6 sm:gap-3 sm:px-6 sm:py-2">
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
      <Button variant="secondary" size="chip" onClick={onAsk} title={askLabel}>
        <IconSparkle size={14} /> <span className="whitespace-nowrap">{askLabel}</span>
      </Button>
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
