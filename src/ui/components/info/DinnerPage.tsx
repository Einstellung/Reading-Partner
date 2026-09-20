// The dinner screen (docs/73): tonight and tomorrow large, the rest of the week
// small, and the shopping list the program derived from them.
//
// Phone first — one column, 16px gutters, nothing that scrolls sideways at
// 390px — and the same column centred on a desktop. Rendering and event binding
// only: which nights are ahead, what a mode is called, how long a thing keeps
// and the order the list is drawn in are all in info/dinner/view.ts.
//
// None of the bureau's vocabulary appears here. It is dinner.

import { useState } from "react";

import { openExternal } from "../../../platform/app/external-link";
import type { DinnerState, ShoppingItem } from "../../../info/dinner/types";
import { ingredientImageUrl } from "../../../info/dinner/images";
import { shoppingItemKey } from "../../../info/dinner/shopping";
import { planExhausted } from "../../../info/dinner/week";
import {
  dishPhotoCredit,
  dishThumbnails,
  headlineDays,
  keepsLabel,
  laterDays,
  leftToBuy,
  modeWord,
  shoppingGroups,
  type DayView,
  type DishPhotoCredit,
} from "../../../info/dinner/view";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { IconSparkle } from "../base/icons";
import { DishImage, IngredientThumb } from "./DinnerImages";

export interface DinnerPageProps {
  // Null while info-dinner.json is being read: the screen holds rather than
  // drawing an empty week that is about to be replaced by a full one.
  state: DinnerState | null;
  today: string;
  onPlanWeek: () => void;
  onAsk: () => void;
  onToggleItem: (key: string, checked: boolean) => void;
}

// The two labelled lines a cooked night is actually made of.
function BasePlus({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div className="mt-1 flex gap-2 text-[13px] leading-snug">
      <span className="w-14 flex-none text-faint-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-muted-foreground">{text}</span>
    </div>
  );
}

function HeadlineDay({ view, credit }: { view: DayView; credit: DishPhotoCredit | null }) {
  const { day, dish } = view;
  // The credit belongs to the photograph, so it goes when the photograph does:
  // a dish picture that fails to load falls back to the ingredient strip, which
  // is TheMealDB's and is credited at the foot of the screen instead.
  const [photoFailed, setPhotoFailed] = useState(false);
  const cooked = day.mode === "cook" || day.mode === "reheat";
  const fresh = day.mode === "reheat" ? (day.freshAdd ?? dish?.fresh ?? "") : (dish?.fresh ?? "");
  return (
    <section className="rounded-xl border border-border-soft bg-card p-4">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[19px] font-semibold text-foreground">{view.word}</span>
        <span className="text-[13px] text-faint-foreground">{view.weekday}</span>
        <span className="flex-1" />
        <span className="text-[13px] font-medium text-accent-line">{modeWord(day.mode)}</span>
      </div>

      {/* 16:9, capped: a photograph gets the width, and the neutral block a
          night has no picture for never grows into a hole the length of the
          card on a wide screen. */}
      <div className="mt-3 aspect-[16/9] max-h-40 w-full">
        <DishImage
          image={dish?.image}
          thumbnails={dishThumbnails(dish, ingredientImageUrl)}
          alt={dish?.name ?? modeWord(day.mode)}
          className="size-full"
          onPhotoFailed={() => setPhotoFailed(true)}
        />
      </div>
      {credit && !photoFailed && (
        <button
          type="button"
          className="mt-1 block max-w-full truncate text-left text-[11px] leading-snug text-faint-foreground underline underline-offset-2 can-hover:hover:text-muted-foreground"
          onClick={() => openExternal(credit.url)}
        >
          {credit.text}
        </button>
      )}

      {cooked && dish ? (
        <>
          <div className="mt-3 text-[17px] font-medium leading-snug text-foreground">{dish.name}</div>
          {dish.oneLine && (
            <p className="m-0 mt-1 text-[14px] leading-relaxed text-muted-foreground">{dish.oneLine}</p>
          )}
          <BasePlus label="Base" text={dish.base} />
          <BasePlus label="Fresh" text={fresh} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-faint-foreground">
              {dish.handsOnMinutes} min hands-on
            </span>
            {dish.keepsADay && (
              <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[12px] text-faint-foreground">
                keeps a day
              </span>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="mt-3 text-[17px] font-medium leading-snug text-foreground">
            {day.place || modeWord(day.mode)}
          </div>
          {cooked && (
            <p className="m-0 mt-1 text-[14px] leading-relaxed text-muted-foreground">
              Nothing is planned for this night yet.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function LaterDay({ view }: { view: DayView }) {
  const { day, dish } = view;
  const name = dish?.name ?? day.place ?? "";
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="w-20 flex-none text-[13px] text-faint-foreground">{view.weekday}</span>
      {dish?.image || dishThumbnails(dish, ingredientImageUrl).length ? (
        <span className="size-10 flex-none">
          <DishImage
            image={dish?.image}
            thumbnails={dishThumbnails(dish, ingredientImageUrl)}
            alt={name}
            className="size-full"
          />
        </span>
      ) : null}
      <span className="w-16 flex-none text-[13px] text-muted-foreground">{modeWord(day.mode)}</span>
      <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">{name}</span>
    </li>
  );
}

function ShoppingLine({
  item,
  onToggle,
}: {
  item: ShoppingItem;
  onToggle: (checked: boolean) => void;
}) {
  const id = `shop-${item.category}-${item.name}`;
  return (
    <li className={`flex items-center gap-3 py-1 ${item.checked ? "opacity-45" : ""}`}>
      <Checkbox
        id={id}
        checked={item.checked}
        onCheckedChange={(v) => onToggle(v === true)}
        aria-label={item.name}
      />
      <IngredientThumb url={ingredientImageUrl(item.en)} category={item.category} alt={item.name} />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block truncate text-[15px] leading-snug text-foreground">{item.name}</span>
        <span className="block text-[12px] text-faint-foreground">
          {item.qty}
          {item.qty ? " · " : ""}
          {keepsLabel(item.keeps)}
          {item.freezeOnArrival ? " · freeze on arrival" : ""}
        </span>
      </label>
    </li>
  );
}

export function DinnerPage(props: DinnerPageProps) {
  const { state, today } = props;
  const plan = state?.plan ?? null;
  const head = headlineDays(plan, today);
  const later = laterDays(plan, today);
  const groups = shoppingGroups(state?.shopping ?? []);
  const left = leftToBuy(state?.shopping ?? []);
  const exhausted = planExhausted(plan, today);
  const planLabel = plan ? "Plan next week" : "Plan this week";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-4 py-5 sm:px-6 sm:py-8">
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-2 border-b border-border-subtle bg-background/85 px-4 py-2 backdrop-blur sm:-mx-6 sm:mb-6 sm:gap-3 sm:px-6 sm:py-3">
        <span className="font-display text-[17px] font-semibold text-foreground">Dinner</span>
        <span className="flex-1" />
        <Button variant="secondary" size="chip" onClick={props.onAsk} title="Ask about dinner">
          <IconSparkle size={14} /> Ask
        </Button>
      </div>

      {state === null ? (
        <div className="h-24" />
      ) : !plan || head.length === 0 ? (
        <div className="rounded-xl border border-border-soft bg-card p-5">
          <p className="m-0 font-display text-[17px] leading-relaxed text-foreground">
            Nothing is planned. Seven nights, the shopping list that goes with them, and you only
            have to say something when a night goes differently.
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
            {head.map((v) => (
              <HeadlineDay
                key={v.day.date}
                view={v}
                credit={dishPhotoCredit(v.dish, state.dishPhotos)}
              />
            ))}
          </div>

          {later.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-1 text-[13px] font-semibold uppercase tracking-wider text-faint-foreground">
                The rest of the week
              </h2>
              <ul className="m-0 flex list-none flex-col divide-y divide-border-subtle p-0">
                {later.map((v) => (
                  <LaterDay key={v.day.date} view={v} />
                ))}
              </ul>
            </section>
          )}

          {exhausted && (
            <div className="mt-6 rounded-xl border border-border-soft bg-card p-4">
              <p className="m-0 text-[14px] leading-relaxed text-muted-foreground">
                This week runs out after tonight.
              </p>
              <div className="mt-3">
                <Button variant="cta" size="chip" className="px-3.5 py-1.5" onClick={props.onPlanWeek}>
                  {planLabel}
                </Button>
              </div>
            </div>
          )}

          {groups.length > 0 && (
            <section className="mt-8">
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="m-0 text-[13px] font-semibold uppercase tracking-wider text-faint-foreground">
                  Shopping
                </h2>
                <span className="flex-1" />
                <span className="text-[13px] text-faint-foreground">{left} left</span>
              </div>
              <div className="flex flex-col gap-4">
                {groups.map((g) => (
                  <div key={g.category}>
                    <h3 className="m-0 mb-1 text-[12px] font-medium uppercase tracking-wider text-faint-foreground">
                      {g.label}
                    </h3>
                    <ul className="m-0 flex list-none flex-col p-0">
                      {g.items.map((item) => (
                        <ShoppingLine
                          key={`${item.category}:${item.name}`}
                          item={item}
                          onToggle={(checked) =>
                            props.onToggleItem(shoppingItemKey(item), checked)
                          }
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      <PhotoCredit />
    </div>
  );
}

/**
 * TheMealDB's terms ask for a link back wherever their artwork is used, and
 * every photograph on this screen is theirs. One line, at the bottom, opened in
 * the system browser like every other outbound link.
 */
function PhotoCredit() {
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

export default DinnerPage;
