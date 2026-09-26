// The meals page (docs/73): the daily targets at the top, the shopping trip,
// today and tomorrow under it, and the rest of the week below that. Every card
// is a button into its own screen — the method, the trip, or one day's meals.
//
// Phone first — one column, 16px gutters, nothing that scrolls sideways at
// 390px — and the same column centred on a desktop. Rendering and event binding
// only: which days are ahead, what a mode is called and the order the shopping
// list is drawn in are all in info/meals/.
//
// None of the bureau's vocabulary appears here. It is what they eat.

import type { Meal, MealsState, ShoppingItem } from "../../../info/meals/plan/types";
import { FOOT_NOTE } from "../../../info/meals/screen/method-screen";
import { dayTotalsLine, mealNumbersLine, weekRowNumbers } from "../../../info/meals/screen/screen-lines";
import { hostRegion } from "../../../info/meals/region";
import type { PhotoCache } from "../../../info/meals/photos/dish-photos";
import {
  linesInOrder,
  orderShoppingLines,
  shoppingPreview,
  shoppingStatus,
} from "../../../info/meals/screen/list-order";
import { EMPTY_SHOPPING } from "../../../info/meals/plan/types";
import { planExhausted } from "../../../info/meals/plan/week";
import {
  dishPicture,
  dishThumbnails,
  mealsView,
  ingredientPicture,
  mealName,
  type DayView,
} from "../../../info/meals/screen/view";
import { Button } from "../ui/button";
import {
  Cells,
  Chevron,
  DayKindTag,
  MealsColumn,
  MealsHeader,
  PhotoCredit,
  TargetsCard,
} from "./MealsChrome";
import { DishImage, IngredientThumb } from "./MealsImages";

export interface MealsHomeProps {
  // Null while info-meals.json is being read: the screen holds rather than
  // drawing an empty week that is about to be replaced by a full one.
  state: MealsState | null;
  // What the search has found so far, keyed by what was searched for. Empty
  // until the run lands, and a week without it is drawn from its ingredients.
  photos: PhotoCache;
  today: string;
  onPlanWeek: () => void;
  onAsk: () => void;
  onOpenShopping: () => void;
  onOpenDay: (date: string) => void;
  onOpenMethod: () => void;
  onReplayOnboarding: () => void;
}

// The meal a day's picture comes from: the latest made main meal.
function leadMeal(view: DayView): Meal | null {
  for (const key of ["dinner", "lunch", "breakfast"] as const) {
    const meal = view.day[key];
    if (meal.mode === "make") return meal;
  }
  return null;
}

/**
 * The picture a day leads with: the dish's photograph in a 16:9 band, or the
 * row of its ingredients' cut-outs, or nothing. The band is the photograph's
 * and not the day's — a card with no photograph shows a row of small squares
 * and is no taller for it (docs/73 图片).
 */
function DayPicture({
  view,
  photos,
  big,
}: {
  view: DayView;
  photos: PhotoCache;
  big: boolean;
}) {
  const lead = leadMeal(view);
  const picture = dishPicture(lead, photos);
  const thumbnails = dishThumbnails(lead?.items, (en) => ingredientPicture(en, photos)?.url ?? null);
  return (
    <DishImage
      image={picture?.url}
      imagePageUrl={picture?.pageUrl}
      thumbnails={thumbnails}
      alt={lead?.name ?? view.word}
      photoClassName={
        big ? "mt-3 aspect-[16/9] max-h-40 w-full" : "mt-2.5 aspect-[16/9] max-h-24 w-full"
      }
      stripClassName={big ? "mt-3" : "mt-2.5"}
    />
  );
}

/** Today's or tomorrow's card: the picture, then the three meals in order. */
function DayCard({
  view,
  photos,
  big,
  onOpen,
}: {
  view: DayView;
  photos: PhotoCache;
  big: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-2xl border border-border-soft bg-card p-5 text-left can-hover:hover:bg-secondary-faint coarse:min-h-[44px]"
    >
      <div className="flex items-center gap-2">
        <span
          className={
            big
              ? "font-display text-[19px] font-medium text-foreground"
              : "font-display text-[17px] font-medium text-foreground"
          }
        >
          {view.word}
        </span>
        {view.word !== view.weekday && (
          <span className="text-[13px] text-faint-foreground">{view.weekday}</span>
        )}
        <span className="flex-1" />
        {view.targets && <DayKindTag training={view.training} />}
        <Chevron />
      </div>
      {dayTotalsLine(view) && (
        <div className="mt-1 text-[13px] tabular-nums text-faint-foreground">{dayTotalsLine(view)}</div>
      )}
      <DayPicture view={view} photos={photos} big={big} />
      {/* Label and dish on the first line, the numbers and the three squares
          under it. A long name wraps rather than truncating — a Chinese name
          cut mid-word says less than a second line costs. */}
      <ul className="m-0 mt-3 flex list-none flex-col p-0">
        {view.meals.map((m) => {
          const numbers = mealNumbersLine(m);
          return (
            <li key={m.key} className="border-t border-border-subtle py-2 first:border-t-0">
              <div className="flex items-start gap-3">
                <span className="w-[62px] flex-none pt-px text-[12px] leading-[20px] text-faint-foreground">
                  {m.label}
                </span>
                <span className="min-w-0 flex-1 text-[15px] leading-[20px] text-foreground">
                  {mealName(m) || m.word}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 pl-[74px] text-[12px] tabular-nums text-faint-foreground">
                <span className="min-w-0 flex-1">{numbers ?? m.word}</span>
                {m.cells && <Cells cells={m.cells} />}
              </div>
            </li>
          );
        })}
      </ul>
    </button>
  );
}

/** The trip, as a card: what is left of it and the next three lines of it. */
function ShoppingCard({
  status,
  preview,
  more,
  photos,
  onOpen,
}: {
  status: string;
  preview: ShoppingItem[];
  more: string | null;
  photos: PhotoCache;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-2xl border border-border-soft bg-card p-5 text-left can-hover:hover:bg-secondary-faint coarse:min-h-[44px]"
    >
      <div className="flex items-baseline gap-2">
        <h2 className="m-0 text-[11px] font-medium uppercase tracking-wider text-faint-foreground">
          Shopping
        </h2>
        <span className="flex-1" />
        <span className="text-[13px] text-faint-foreground">{status}</span>
        <Chevron />
      </div>
      {preview.length > 0 && (
        <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
          {preview.map((item) => (
            <li key={`${item.category}:${item.name}`} className="flex items-center gap-2.5">
              <IngredientThumb
                size={28}
                url={ingredientPicture(item.en, photos)?.url ?? null}
                pageUrl={ingredientPicture(item.en, photos)?.pageUrl ?? null}
                category={item.category}
                alt={item.name}
              />
              <span className="min-w-0 flex-1 truncate text-[15px] leading-snug text-foreground">
                {item.name}
              </span>
              <span className="flex-none text-[13px] tabular-nums text-faint-foreground">
                {item.qty}
              </span>
            </li>
          ))}
        </ul>
      )}
      {more && <div className="mt-2.5 text-[13px] text-faint-foreground">{more}</div>}
    </button>
  );
}

/** One of the days after tomorrow: a thumbnail and what lunch and dinner are. */
function WeekRow({
  view,
  photos,
  onOpen,
}: {
  view: DayView;
  photos: PhotoCache;
  onOpen: () => void;
}) {
  const lead = leadMeal(view);
  const picture = dishPicture(lead, photos);
  const thumbnails = dishThumbnails(lead?.items, (en) => ingredientPicture(en, photos)?.url ?? null);
  const lunch = view.meals.find((m) => m.key === "lunch");
  const dinner = view.meals.find((m) => m.key === "dinner");
  const numbers = weekRowNumbers(view);
  return (
    <li className="border-t border-border-subtle first:border-t-0">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-[44px] w-full items-center gap-3 py-2.5 text-left"
      >
        <span className="w-[76px] flex-none text-[13px] text-faint-foreground">
          {view.weekday}
          {view.targets && (
            <small className={view.training ? "block text-[11px] text-accent-line" : "block text-[11px]"}>
              {view.training ? "Training" : "Rest"}
            </small>
          )}
        </span>
        {/* The slot is kept whether or not there is anything to put in it: a
            night with no picture would otherwise start its text a square to
            the left of the nights above and below it. */}
        <span className="size-8 flex-none">
          <DishImage
            image={picture?.url}
            imagePageUrl={picture?.pageUrl}
            thumbnails={thumbnails}
            alt={lead?.name ?? view.weekday}
            size="row"
            photoClassName="size-full"
          />
        </span>
        {/* Two dishes on one line, wrapping to a second rather than ending in
            an ellipsis: the name that gets cut is the one the reader does not
            already know. */}
        <span className="min-w-0 flex-1 text-[15px] leading-snug text-foreground">
          {lunch ? lunch.name || lunch.word : ""}
          <span className="text-faint-foreground"> · </span>
          {dinner ? dinner.name || dinner.word : ""}
        </span>
        {numbers && (
          <span className="flex-none text-right text-[12px] leading-snug tabular-nums text-faint-foreground">
            {numbers[0]}
            <br />
            {numbers[1]}
          </span>
        )}
        <Chevron />
      </button>
    </li>
  );
}

export function MealsHome(props: MealsHomeProps) {
  const { state, today, photos } = props;
  const plan = state?.plan ?? null;
  const view = state ? mealsView(state, today, hostRegion()) : null;
  const head = view?.headline ?? [];
  const later = view?.later ?? [];
  const shopping = state?.shopping ?? EMPTY_SHOPPING;
  // The page's own read of the list is a card's worth of preview, so it is
  // settled here rather than carried: nothing is ticked from this screen.
  const lines = linesInOrder(shopping, orderShoppingLines(shopping));
  const preview = shoppingPreview(shopping, lines);
  const exhausted = planExhausted(plan, today);
  const planLabel = plan ? "Plan next week" : "Plan this week";

  return (
    <MealsColumn>
      <MealsHeader title="Meals" askLabel="Ask about this week" onAsk={props.onAsk} />
      {state !== null && (
        <div className="mb-3 flex flex-wrap gap-2">
          <Button variant="outline" size="chip" onClick={props.onReplayOnboarding}>
            Replay onboarding
          </Button>
          {view?.targets && (
            <Button variant="outline" size="chip" onClick={props.onOpenMethod}>
              Method &amp; sources
            </Button>
          )}
        </div>
      )}
      {view?.summary && (
        <div className="mb-4">
          <TargetsCard summary={view.summary} onMethod={props.onOpenMethod} />
        </div>
      )}

      {state === null ? (
        <div className="h-24" />
      ) : !plan || head.length === 0 ? (
        <div className="rounded-2xl border border-border-soft bg-card p-5">
          <p className="m-0 font-display text-[17px] leading-relaxed text-foreground">
            Nothing is planned. Four meals a day for seven days, each about ten minutes, and the
            shopping list that goes with them.
          </p>
          <div className="mt-4">
            <Button variant="cta" onClick={props.onPlanWeek}>
              {planLabel}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            {lines.length > 0 && (
              <ShoppingCard
                status={shoppingStatus(shopping, lines)}
                preview={preview.items}
                more={preview.more}
                photos={photos}
                onOpen={props.onOpenShopping}
              />
            )}
            {head[0] && (
              <DayCard
                view={head[0]}
                photos={photos}
                big
                onOpen={() => props.onOpenDay(head[0].day.date)}
              />
            )}
            {head[1] && (
              <DayCard
                view={head[1]}
                photos={photos}
                big={false}
                onOpen={() => props.onOpenDay(head[1].day.date)}
              />
            )}
          </div>

          {later.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-faint-foreground">
                The rest of the week
              </h2>
              <ul className="m-0 flex list-none flex-col p-0">
                {later.map((v) => (
                  <WeekRow
                    key={v.day.date}
                    view={v}
                    photos={photos}
                    onOpen={() => props.onOpenDay(v.day.date)}
                  />
                ))}
              </ul>
            </section>
          )}

          {exhausted && (
            <div className="mt-6 rounded-2xl border border-border-soft bg-card p-5">
              <p className="m-0 text-[14px] leading-relaxed text-muted-foreground">
                This week runs out after today.
              </p>
              <div className="mt-3">
                <Button variant="cta" size="chip" className="px-3.5 py-1.5" onClick={props.onPlanWeek}>
                  Plan next week
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      <p className="m-0 mt-7 text-[11px] leading-snug text-faint-foreground">{FOOT_NOTE}</p>
      <PhotoCredit />
    </MealsColumn>
  );
}
