// The meals page (docs/73): the shopping trip at the top, today and tomorrow
// under it, and the rest of the week below that. Every card is a button into
// its own screen — the trip, or one day's three meals.
//
// Phone first — one column, 16px gutters, nothing that scrolls sideways at
// 390px — and the same column centred on a desktop. Rendering and event binding
// only: which days are ahead, what a mode is called and the order the shopping
// list is drawn in are all in info/meals/.
//
// None of the bureau's vocabulary appears here. It is what they eat.

import type { MealsState, ShoppingItem } from "../../../info/meals/types";
import type { PhotoCache } from "../../../info/meals/dish-photos";
import {
  linesInOrder,
  orderShoppingLines,
  shoppingPreview,
  shoppingStatus,
} from "../../../info/meals/list-order";
import { EMPTY_SHOPPING } from "../../../info/meals/types";
import { planExhausted } from "../../../info/meals/week";
import {
  dishPicture,
  dishThumbnails,
  headlineDays,
  ingredientPicture,
  laterDays,
  mealName,
  type DayView,
} from "../../../info/meals/view";
import { Button } from "../ui/button";
import { Chevron, MealsColumn, MealsHeader, PhotoCredit } from "./MealsChrome";
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
}

/** The picture a day leads with, at the size the card gives it. */
function DayPicture({
  view,
  photos,
  big,
}: {
  view: DayView;
  photos: PhotoCache;
  big: boolean;
}) {
  const picture = dishPicture(view.dish, photos);
  const thumbnails = dishThumbnails(view.dish, (en) => ingredientPicture(en, photos)?.url ?? null);
  return (
    <div className={big ? "mt-3 aspect-[16/9] max-h-40 w-full" : "mt-2.5 aspect-[16/9] max-h-24 w-full"}>
      <DishImage
        image={picture?.url}
        imagePageUrl={picture?.pageUrl}
        thumbnails={thumbnails}
        alt={view.dish?.name ?? view.word}
        className="size-full"
      />
    </div>
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
      className="block w-full rounded-xl border border-border-soft bg-card p-4 text-left can-hover:hover:bg-secondary-faint coarse:min-h-[44px]"
    >
      <div className="flex items-baseline gap-2">
        <span
          className={
            big
              ? "font-display text-[19px] font-semibold text-foreground"
              : "font-display text-[17px] font-semibold text-foreground"
          }
        >
          {view.word}
        </span>
        {view.word !== view.weekday && (
          <span className="text-[13px] text-faint-foreground">{view.weekday}</span>
        )}
        <span className="flex-1" />
        <Chevron />
      </div>
      <DayPicture view={view} photos={photos} big={big} />
      <ul className="m-0 mt-3 flex list-none flex-col p-0">
        {view.meals.map((m) => (
          <li key={m.key} className="flex items-baseline gap-2 py-[3px] text-[14px] leading-normal">
            <span className="w-[70px] flex-none text-[12px] text-faint-foreground">{m.label}</span>
            <span className="w-[58px] flex-none text-[13px] text-accent-line">{m.word}</span>
            <span className="min-w-0 flex-1 truncate text-foreground">{mealName(m)}</span>
          </li>
        ))}
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
      className="block w-full rounded-xl border border-border-soft bg-card p-4 text-left can-hover:hover:bg-secondary-faint coarse:min-h-[44px]"
    >
      <div className="flex items-baseline gap-2">
        <h2 className="m-0 text-[13px] font-semibold uppercase tracking-wider text-faint-foreground">
          Shopping
        </h2>
        <span className="flex-1" />
        <span className="text-[13px] text-faint-foreground">{status}</span>
        <Chevron />
      </div>
      {preview.length > 0 && (
        <ul className="m-0 mt-2.5 flex list-none flex-col gap-1.5 p-0">
          {preview.map((item) => (
            <li key={`${item.category}:${item.name}`} className="flex items-center gap-2.5">
              <IngredientThumb
                size={28}
                url={ingredientPicture(item.en, photos)?.url ?? null}
                pageUrl={ingredientPicture(item.en, photos)?.pageUrl ?? null}
                category={item.category}
                alt={item.name}
              />
              <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">{item.name}</span>
              <span className="flex-none text-[12px] text-faint-foreground">{item.qty}</span>
            </li>
          ))}
        </ul>
      )}
      {more && <div className="mt-2 text-[12px] text-faint-foreground">{more}</div>}
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
  const picture = dishPicture(view.dish, photos);
  const thumbnails = dishThumbnails(view.dish, (en) => ingredientPicture(en, photos)?.url ?? null);
  const lunch = view.meals.find((m) => m.key === "lunch");
  const dinner = view.meals.find((m) => m.key === "dinner");
  return (
    <li className="border-t border-border-subtle first:border-t-0">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-[44px] w-full items-center gap-3 py-2 text-left"
      >
        <span className="w-[76px] flex-none text-[13px] text-faint-foreground">{view.weekday}</span>
        {(picture || thumbnails.length > 0) && (
          <span className="size-8 flex-none">
            <DishImage
              image={picture?.url}
              imagePageUrl={picture?.pageUrl}
              thumbnails={thumbnails}
              alt={view.dish?.name ?? view.weekday}
              className="size-full"
            />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">
          {lunch ? mealName(lunch) : ""} · {dinner ? mealName(dinner) : ""}
        </span>
        <Chevron />
      </button>
    </li>
  );
}

export function MealsHome(props: MealsHomeProps) {
  const { state, today, photos } = props;
  const plan = state?.plan ?? null;
  const head = headlineDays(plan, today);
  const later = laterDays(plan, today);
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

      {state === null ? (
        <div className="h-24" />
      ) : !plan || head.length === 0 ? (
        <div className="rounded-xl border border-border-soft bg-card p-5">
          <p className="m-0 font-display text-[17px] leading-relaxed text-foreground">
            Nothing is planned. Three meals a day for seven days, the shopping list that goes with
            them, and you only have to say something when a meal goes differently.
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
              <h2 className="mb-1 text-[13px] font-semibold uppercase tracking-wider text-faint-foreground">
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
            <div className="mt-6 rounded-xl border border-border-soft bg-card p-4">
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
      <PhotoCredit />
    </MealsColumn>
  );
}

export default MealsHome;
