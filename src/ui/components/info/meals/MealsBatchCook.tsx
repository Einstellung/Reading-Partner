// The batch-cooking card at the top of the Meals page (docs/671 备餐页): plan
// one, the prep still ahead, or what is next once it is done. Rendering only;
// the state and its words are info/meals/screen/batch-cook.ts.

import type { EntryAction, EntryCardView } from "../../../../info/meals/screen/batch-cook";
import { Button } from "../../ui/button";
import { Chevron } from "./MealsChrome";

export function BatchCookCard({ view, onAction }: { view: EntryCardView; onAction: (action: EntryAction) => void }) {
  const open = view.open;
  const primary = view.primary;
  const head = (
    <>
      <div className="text-[11px] font-medium uppercase tracking-wider text-faint-foreground">{view.kicker}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="min-w-0 flex-1 font-display text-[19px] font-medium leading-snug text-foreground">{view.title}</span>
        {open && <Chevron />}
      </div>
      {view.lines.map((line) => (
        <div key={line} className="mt-1 text-[13px] leading-snug text-muted-foreground">
          {line}
        </div>
      ))}
    </>
  );
  return (
    <section aria-label={view.kicker} className="rounded-2xl border border-border-soft bg-card p-5">
      {open ? (
        <button type="button" className="block w-full text-left coarse:min-h-[44px]" onClick={() => onAction(open)}>
          {head}
        </button>
      ) : (
        head
      )}
      {(primary || view.secondary.length > 0) && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {primary && (
            <Button variant="cta" onClick={() => onAction(primary.action)}>
              {primary.label}
            </Button>
          )}
          {view.secondary.map((b) => (
            <Button key={b.label} variant="outline" size="chip" onClick={() => onAction(b.action)}>
              {b.label}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
