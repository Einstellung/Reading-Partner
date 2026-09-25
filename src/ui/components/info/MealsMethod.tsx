// Method & sources (docs/73 屏幕): every formula with the reader's own numbers
// worked through, the food table with each row's source, and the medical and
// health-data notes. Rendering only; the text is info/meals/method-screen.ts.

import { openExternal } from "../../../platform/app/external-link";
import { hostRegion } from "../../../info/meals/region";
import {
  HEALTH_DATA_NOTE,
  MEDICAL_NOTE,
  foodTableRows,
  methodSections,
  type TextSegment,
} from "../../../info/meals/method-screen";
import { targetsOf } from "../../../info/meals/solve-week";
import type { MealsState } from "../../../info/meals/types";
import { MealsColumn, MealsHeader } from "./MealsChrome";

export interface MealsMethodProps {
  state: MealsState | null;
  onBack: () => void;
}

function Segments({ segments }: { segments: TextSegment[] }) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.url ? (
          <button
            key={i}
            type="button"
            className="inline text-left text-accent-line underline underline-offset-2"
            onClick={() => openExternal(seg.url ?? "")}
          >
            {seg.text}
          </button>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

function FoodTable() {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-[12px] tabular-nums">
        <thead>
          <tr className="text-faint-foreground">
            <th className="py-1 pr-2 text-left font-normal">Food</th>
            <th className="py-1 pr-2 text-right font-normal">kcal</th>
            <th className="py-1 pr-2 text-right font-normal">P</th>
            <th className="py-1 pr-2 text-right font-normal">F</th>
            <th className="py-1 pr-2 text-right font-normal">C</th>
            <th className="py-1 text-left font-normal">Source</th>
          </tr>
        </thead>
        <tbody>
          {foodTableRows().map((r) => (
            <tr key={r.id} className="border-t border-border-subtle text-foreground">
              <td className="whitespace-nowrap py-1 pr-2">{r.name}</td>
              <td className="py-1 pr-2 text-right">{r.kcal}</td>
              <td className="py-1 pr-2 text-right">{r.protein}</td>
              <td className="py-1 pr-2 text-right">{r.fat}</td>
              <td className="py-1 pr-2 text-right">{r.carbs}</td>
              <td className="py-1 text-muted-foreground">{r.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MealsMethod(props: MealsMethodProps) {
  const profile = props.state?.charter?.profile ?? null;
  const targets = props.state ? targetsOf(props.state.charter, hostRegion()) : null;
  const sections = targets && profile ? methodSections(targets, profile) : [];

  return (
    <MealsColumn>
      <MealsHeader title="Method & sources" onBack={props.onBack} />
      <p className="m-0 text-[14px] leading-relaxed text-muted-foreground">
        Every number in Meals comes from the steps below. Worked lines use your answers.
      </p>
      <div className="mt-3 flex flex-col gap-4">
        {sections.map((s) => (
          <section key={s.n} className="rounded-2xl border border-border-soft bg-card p-5">
            <h2 className="m-0 font-display text-[17px] font-medium text-foreground">
              {s.n}. {s.title}
            </h2>
            {/* Section 7 is a paragraph about the table, not a formula. */}
            {s.formula && !s.yours && (
              <p className="m-0 mt-2 text-[14px] leading-relaxed text-foreground">{s.formula}</p>
            )}
            {s.formula && s.yours && (
              <div className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-muted-faint px-2.5 py-2 font-mono text-[13px] leading-relaxed text-foreground">
                {s.formula}
              </div>
            )}
            {s.yours && (
              <div className="mt-2 whitespace-pre-wrap border-l-2 border-accent-line px-2.5 py-2 text-[13px] leading-relaxed text-muted-foreground">
                {s.yours}
              </div>
            )}
            {s.n === 7 && <FoodTable />}
            {s.sources.length > 0 && (
              <p className="m-0 mt-1.5 break-words text-[13px] leading-relaxed text-faint-foreground">
                <Segments segments={s.sources} />
              </p>
            )}
          </section>
        ))}
        <div className="rounded-xl border border-secondary-border bg-secondary-faint px-4 py-3.5 text-[14px] leading-relaxed text-foreground">
          {MEDICAL_NOTE}
        </div>
        <p className="m-0 text-[13px] leading-relaxed text-faint-foreground">{HEALTH_DATA_NOTE}</p>
      </div>
    </MealsColumn>
  );
}
