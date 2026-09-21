// One day (docs/73): the three meals stacked, and for the ones actually cooked
// here, the steps.
//
// The steps are asked for when this screen opens and not before — most dishes
// of a week are never opened, and a week of steps written up front is a week of
// tokens spent on nothing (method.ts). Until the answer lands the Method box
// says it is being written; when it lands, that box fills and nothing else on
// the screen moves.
//
// Rendering and event binding only.

import { useEffect, useRef, useState } from "react";

import { openExternal } from "../../../platform/app/external-link";
import type { PhotoCache } from "../../../info/meals/dish-photos";
import { markDishPhotoBroken } from "../../../info/meals/photo-store";
import type { DishMethod, MealsState } from "../../../info/meals/types";
import {
  dayViewOn,
  dishPhotoCredit,
  dishPicture,
  dishThumbnails,
  ingredientPicture,
  modeWord,
  weekdayName,
  type MealView,
} from "../../../info/meals/view";
import { MealsColumn, MealsHeader, PhotoCredit } from "./MealsChrome";
import { DishImage } from "./MealsImages";

export interface MealsDayProps {
  state: MealsState | null;
  photos: PhotoCache;
  today: string;
  date: string;
  onBack: () => void;
  onAsk: () => void;
  // One headless turn per dish, at most once however many callers ask
  // (ensureDishMethod). Null is "this day has no steps", which is the state
  // every day starts in.
  onWriteMethod: (dishId: string) => Promise<DishMethod | null>;
}

/** The two labelled lines a cooked meal is actually made of. */
function BasePlus({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div className="mt-1 flex gap-2 text-[13px] leading-snug">
      <span className="w-14 flex-none text-faint-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-muted-foreground">{text}</span>
    </div>
  );
}

function Method({ method }: { method: DishMethod | null }) {
  return (
    <div className="mt-3.5 border-t border-border-subtle pt-3">
      <h3 className="m-0 text-[12px] font-semibold uppercase tracking-wider text-faint-foreground">
        Method
      </h3>
      {method ? (
        <>
          <ol className="m-0 mt-2 flex list-none flex-col gap-[7px] p-0">
            {method.steps.map((step, i) => (
              <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed text-foreground">
                <span className="w-[18px] flex-none text-[12px] leading-[1.9] tabular-nums text-faint-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">{step}</span>
              </li>
            ))}
          </ol>
          {method.note && (
            <p className="m-0 mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
              {method.note}
            </p>
          )}
        </>
      ) : (
        <p className="m-0 mt-2.5 text-[13px] text-faint-foreground">Writing the steps…</p>
      )}
    </div>
  );
}

function MealCard({
  view,
  photos,
  method,
}: {
  view: MealView;
  photos: PhotoCache;
  // Undefined for a meal with no steps to show at all; null while they are
  // being written.
  method?: DishMethod | null;
}) {
  const { meal, dish } = view;
  const [photoFailed, setPhotoFailed] = useState(false);
  const cooked = (meal.mode === "cook" || meal.mode === "reheat" || meal.mode === "packed") && !!dish;
  const picture = cooked ? dishPicture(dish, photos) : null;
  const credit = cooked ? dishPhotoCredit(dish, photos) : null;
  const fresh = meal.mode === "reheat" ? (meal.freshAdd ?? dish?.fresh ?? "") : (dish?.fresh ?? "");

  return (
    <section className="rounded-xl border border-border-soft bg-card p-4">
      <div className="flex items-baseline gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-faint-foreground">
          {view.label}
        </span>
        <span className="flex-1" />
        <span className="text-[13px] font-medium text-accent-line">{modeWord(meal.mode)}</span>
      </div>

      {cooked && dish ? (
        <>
          <div className="mt-3 aspect-[16/9] max-h-40 w-full">
            <DishImage
              image={picture?.url}
              imagePageUrl={picture?.pageUrl}
              thumbnails={dishThumbnails(dish, (en) => ingredientPicture(en, photos)?.url ?? null)}
              alt={dish.name}
              className="size-full"
              onPhotoFailed={() => {
                setPhotoFailed(true);
                // A picture the search found and this app cannot load is dropped
                // from the cache, so the next Apply looks the dish up again
                // rather than loading the same dead URL every week.
                if (dish.searchName) void markDishPhotoBroken(dish.searchName);
              }}
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
          <div className="mt-3 text-[17px] font-medium leading-snug text-foreground">{dish.name}</div>
          {dish.oneLine && (
            <p className="m-0 mt-1 text-[14px] leading-relaxed text-muted-foreground">{dish.oneLine}</p>
          )}
          {meal.note && (
            <p className="m-0 mt-1 text-[14px] leading-relaxed text-muted-foreground">{meal.note}</p>
          )}
          <BasePlus label="Base" text={dish.base} />
          <BasePlus label="Fresh" text={fresh} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-faint-foreground">{dish.handsOnMinutes} min hands-on</span>
            {dish.keepsADay && (
              <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[12px] text-faint-foreground">
                keeps a day
              </span>
            )}
          </div>
          {/* Steps only where the meal is actually cooked here. A packed lunch
              is a box; it was cooked at the meal its pointer names. */}
          {method !== undefined && <Method method={method} />}
        </>
      ) : (
        <>
          <div className="mt-3 text-[17px] font-medium leading-snug text-foreground">
            {meal.place || modeWord(meal.mode)}
          </div>
          {meal.note && (
            <p className="m-0 mt-1 text-[14px] leading-relaxed text-muted-foreground">{meal.note}</p>
          )}
        </>
      )}
    </section>
  );
}

export function MealsDay(props: MealsDayProps) {
  const { state, photos, today, date } = props;
  const view = dayViewOn(state?.plan ?? null, date, today);

  // The steps as they land, held here rather than read back through the whole
  // state: a reload would hand every box on the screen a new object, and this
  // one box is the only thing that changed.
  const [written, setWritten] = useState<Record<string, DishMethod>>({});
  const asked = useRef(new Set<string>());
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const wanted = (view?.meals ?? [])
    .filter((m) => (m.meal.mode === "cook" || m.meal.mode === "reheat") && m.dish)
    .map((m) => m.dish as NonNullable<typeof m.dish>);
  const missing = wanted.filter((d) => !d.method && !written[d.id]).map((d) => d.id);
  const missingKey = missing.join(",");
  const write = props.onWriteMethod;
  useEffect(() => {
    for (const dishId of missingKey ? missingKey.split(",") : []) {
      if (asked.current.has(dishId)) continue;
      asked.current.add(dishId);
      void write(dishId).then(
        (method) => {
          if (method && live.current) setWritten((prev) => ({ ...prev, [dishId]: method }));
        },
        () => {},
      );
    }
  }, [missingKey, write]);

  const word = view?.word ?? "";
  const askLabel = word === "Today" ? "Ask about today" : `Ask about ${weekdayName(date)}`;

  return (
    <MealsColumn>
      <MealsHeader
        title={word || weekdayName(date)}
        weekday={word && word !== weekdayName(date) ? weekdayName(date) : null}
        askLabel={askLabel}
        onAsk={props.onAsk}
        onBack={props.onBack}
      />
      {view === null ? (
        <div className="h-24" />
      ) : (
        <div className="flex flex-col gap-4">
          {view.meals.map((m) => {
            const cooking = m.meal.mode === "cook" || m.meal.mode === "reheat";
            const method = m.dish ? (m.dish.method ?? written[m.dish.id] ?? null) : null;
            return (
              <MealCard
                key={m.key}
                view={m}
                photos={photos}
                {...(cooking && m.dish ? { method } : {})}
              />
            );
          })}
        </div>
      )}
      <PhotoCredit />
    </MealsColumn>
  );
}

export default MealsDay;
