// The shopping trip (docs/73 采购单): one list, walked once, and then closed.
//
// Before Done it is a list: aisles in the order a shop is walked, a 44px box
// per line, and a Done button that follows the thumb down a long list. After
// Done it is a record: what came home, what is still to be picked up because
// the reader said they were passing a shop, and what the trip missed. Nothing
// reopens it — a week has one trip.
//
// Rendering and event binding only. The order the lines are drawn in, and the
// words above them, are in info/meals/list-order.ts.

import { useRef } from "react";

import type { MealsState, ShoppingItem } from "../../../info/meals/types";
import type { PhotoCache } from "../../../info/meals/dish-photos";
import {
  aislesOf,
  linesInOrder,
  LONG_LIST,
  orderShoppingLines,
} from "../../../info/meals/list-order";
import { isChecked, missed, shoppingItemKey, stillToGet } from "../../../info/meals/shopping";
import { EMPTY_SHOPPING } from "../../../info/meals/types";
import { ingredientPicture, shoppingNote, weekdayName } from "../../../info/meals/view";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { MealsColumn, MealsHeader, PhotoCredit } from "./MealsChrome";
import { IngredientThumb } from "./MealsImages";

export interface MealsShoppingProps {
  state: MealsState | null;
  photos: PhotoCache;
  onBack: () => void;
  onAsk: () => void;
  onToggleItem: (key: string, checked: boolean) => void;
  onDone: () => void;
}

/** The tick a settled trip keeps: it can no longer be lost, or given. */
function Mark({ on }: { on: boolean }) {
  return (
    <span className="flex size-4 flex-none items-center justify-center text-accent-line">
      {on ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M1.8 6.2 4.6 9 10.2 2.8" />
        </svg>
      ) : null}
    </span>
  );
}

function Line({
  item,
  checked,
  photos,
  mark,
  onToggle,
}: {
  item: ShoppingItem;
  checked: boolean;
  photos: PhotoCache;
  // A settled line, drawn with a mark instead of a box nobody can press.
  mark: boolean;
  onToggle?: (checked: boolean) => void;
}) {
  const picture = ingredientPicture(item.en, photos);
  const id = `shop-${item.category}-${item.name}`;
  return (
    <li className={`flex items-center gap-3 py-1.5 ${checked && !mark ? "opacity-45" : ""}`}>
      {mark ? (
        <Mark on={checked} />
      ) : (
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={(v) => onToggle?.(v === true)}
          aria-label={item.name}
        />
      )}
      <IngredientThumb
        url={picture?.url ?? null}
        pageUrl={picture?.pageUrl ?? null}
        category={item.category}
        alt={item.name}
      />
      <label htmlFor={mark ? undefined : id} className={mark ? "min-w-0 flex-1" : "min-w-0 flex-1 cursor-pointer"}>
        <span className="block truncate text-[15px] leading-snug text-foreground">
          {item.name}
          {item.source === "reader" && (
            <span className="ml-2 rounded-full border border-border px-1.5 py-px align-[1px] text-[11px] leading-normal text-faint-foreground">
              added
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[12px] leading-snug text-faint-foreground">
          {shoppingNote(item)}
        </span>
      </label>
      {/* The quantity, on the right and in the one place it can be read down a
          column: the reader is standing in a shop holding a basket. */}
      <span className="flex-none text-[13px] tabular-nums text-faint-foreground">{item.qty}</span>
    </li>
  );
}

interface GroupProps {
  items: ShoppingItem[];
  state: MealsState;
  photos: PhotoCache;
  mark: boolean;
  onToggleItem: (key: string, checked: boolean) => void;
}

function Lines({ items, state, photos, mark, onToggleItem }: GroupProps) {
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {items.map((item) => (
        <Line
          key={shoppingItemKey(item)}
          item={item}
          checked={isChecked(state.shopping, item)}
          photos={photos}
          mark={mark}
          onToggle={(checked) => onToggleItem(shoppingItemKey(item), checked)}
        />
      ))}
    </ul>
  );
}

function Aisles({ items, ...rest }: GroupProps) {
  return (
    <div className="flex flex-col gap-4">
      {aislesOf(items).map((aisle) => (
        <div key={aisle.category}>
          <h3 className="m-0 mb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint-foreground">
            {aisle.label}
          </h3>
          <Lines items={aisle.items} {...rest} />
        </div>
      ))}
    </div>
  );
}

function FlatGroup({ title, hint, ...rest }: GroupProps & { title: string; hint?: string }) {
  return (
    <div className="mt-5">
      <h3 className="m-0 mb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint-foreground">
        {title}
      </h3>
      {hint && <p className="m-0 mb-1.5 text-[12px] leading-normal text-faint-foreground">{hint}</p>}
      <Lines {...rest} />
    </div>
  );
}

export function MealsShopping(props: MealsShoppingProps) {
  const { state, photos } = props;
  const shopping = state?.shopping ?? EMPTY_SHOPPING;
  // The order is settled once and then honoured: a tick changes the box and the
  // count above it, and the line stays where the thumb left it. The sink
  // happens the next time this screen is opened, with no previous order to
  // honour (list-order.ts).
  const orderRef = useRef<string[] | null>(null);
  const order = orderShoppingLines(shopping, orderRef.current ?? undefined);
  if (state !== null) orderRef.current = order;
  const lines = linesInOrder(shopping, order);
  const done = shopping.doneOn;

  const left = lines.filter((i) => !isChecked(shopping, i));
  const bought = lines.filter((i) => isChecked(shopping, i));
  const toGet = stillToGet(shopping, lines);
  const missedLines = missed(shopping, lines);

  return (
    <MealsColumn>
      <MealsHeader
        title={done ? `Bought · ${weekdayName(done)}` : "Shopping"}
        askLabel="Ask about shopping"
        onAsk={props.onAsk}
        onBack={props.onBack}
      />

      {state === null ? (
        <div className="h-24" />
      ) : done ? (
        <>
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="m-0 text-[13px] font-semibold uppercase tracking-wider text-faint-foreground">
              Bought
            </h2>
            <span className="flex-1" />
            <span className="text-[13px] text-faint-foreground">
              {bought.length} of {lines.length}
            </span>
          </div>
          <Aisles
            items={bought}
            state={state}
            photos={photos}
            mark
            onToggleItem={props.onToggleItem}
          />
          {toGet.length > 0 && (
            <FlatGroup
              title="To get on the way"
              items={toGet}
              state={state}
              photos={photos}
              mark={false}
              onToggleItem={props.onToggleItem}
            />
          )}
          {missedLines.length > 0 && (
            <FlatGroup
              title="Didn't get"
              hint="Say so in Ask and the week adjusts"
              items={missedLines}
              state={state}
              photos={photos}
              mark
              onToggleItem={props.onToggleItem}
            />
          )}
        </>
      ) : (
        <>
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="m-0 text-[13px] font-semibold uppercase tracking-wider text-faint-foreground">
              Still to buy
            </h2>
            <span className="flex-1" />
            <span className="text-[13px] text-faint-foreground">{left.length} left</span>
          </div>
          <Aisles
            items={lines}
            state={state}
            photos={photos}
            mark={false}
            onToggleItem={props.onToggleItem}
          />
          {/* A trip has an end. On a long list the button rides the bottom of
              the screen rather than waiting at the foot of two dozen lines. */}
          {lines.length > LONG_LIST ? (
            <div className="sticky bottom-0 -mx-4 mt-5 flex border-t border-border-subtle bg-background/90 px-4 py-2.5 pb-safe backdrop-blur sm:-mx-6 sm:px-6">
              <Button variant="cta" className="flex-1" onClick={props.onDone}>
                Done
              </Button>
            </div>
          ) : (
            <div className="mt-5 flex">
              <Button variant="cta" className="flex-1" onClick={props.onDone}>
                Done
              </Button>
            </div>
          )}
        </>
      )}
      <PhotoCredit />
    </MealsColumn>
  );
}
