// The Meals onboarding thread (docs/73 首次): scripted questions answered by
// tapping, then the daily targets and the button that plans the week.
//
// Rendering and event binding only. The steps, their answers, what completes
// them and the profile they make are info/meals/screen/onboarding.ts.

import { useEffect, useReducer, useRef, useState } from "react";

import { useT } from "../../../../i18n";
import { computeTargets, type Profile } from "../../../../info/meals/nutrition/targets";
import {
  AVOID_OPTIONS,
  CONSENT_OPTIONS,
  GOAL_OPTIONS,
  INTRO_LINE,
  KITCHEN_OPTIONS,
  NO_CONSENT_REPLY,
  PEOPLE_OPTIONS,
  RESULT_STEP,
  SEX_OPTIONS,
  SHOP_OPTIONS,
  STEPS,
  TRAIN_TIME_OPTIONS,
  WORK_OPTIONS,
  ZH_WEEKDAY,
  answerText,
  initialOnboarding,
  onboardingReducer,
  questionText,
  resultLine,
  stepDone,
  toProfile,
  type OnboardingAction,
  type OnboardingState,
  type StepId,
  type StepperField,
} from "../../../../info/meals/screen/onboarding";
import { hostRegion } from "../../../../info/meals/region";
import { targetsSummary } from "../../../../info/meals/screen/view";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/button";
import { MealsColumn, MealsHeader, TargetsCard } from "./MealsChrome";

export interface MealsOnboardingProps {
  // The profile a replay starts its numbers from; null on a first run.
  existing: Profile | null;
  // Save the profile and plan the week. Resolves false when the save failed.
  onFinish: (profile: Profile) => Promise<boolean>;
  // Present on a replay, which has a home to go back to.
  onBack?: () => void;
}

type Dispatch = (a: OnboardingAction) => void;

function Ai({ children }: { children: React.ReactNode }) {
  return <div className="text-[15px] leading-[1.65] text-foreground">{children}</div>;
}

function Opt({
  selected,
  label,
  sub,
  className,
  onClick,
}: {
  selected: boolean;
  label: string;
  sub?: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="lg"
      aria-pressed={selected}
      className={cn(
        "h-auto flex-col items-start gap-0 bg-card text-left text-[15px] font-normal text-foreground",
        selected && "border-secondary-border bg-secondary font-semibold",
        className,
      )}
      onClick={onClick}
    >
      <span>
        {selected && <span className="text-accent-line">{"✓ "}</span>}
        {label}
      </span>
      {sub && <small className="mt-px text-[12px] font-normal text-muted-foreground">{sub}</small>}
    </Button>
  );
}

function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border-subtle py-2.5 first:border-t-0 first:pt-0">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-2 text-[13px] text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function Stepper({
  field,
  value,
  unit,
  dispatch,
}: {
  field: StepperField;
  value: string;
  unit: string;
  dispatch: Dispatch;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="icon"
        aria-label={t("meals.less")}
        className="text-[20px]"
        onClick={() => dispatch({ type: "step", field, dir: -1 })}
      >
        −
      </Button>
      <span className="min-w-0 flex-1 text-center font-display text-[20px] tabular-nums text-foreground">
        {value}
        <small className="ml-[3px] text-[13px] text-faint-foreground">{unit}</small>
      </span>
      <Button
        variant="outline"
        size="icon"
        aria-label={t("meals.more")}
        className="text-[20px]"
        onClick={() => dispatch({ type: "step", field, dir: 1 })}
      >
        +
      </Button>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2.5 rounded-2xl border border-border-soft bg-card p-3.5">{children}</div>
  );
}

function Opts({ children, column }: { children: React.ReactNode; column?: boolean }) {
  return <div className={cn("flex flex-wrap gap-2", column && "flex-col")}>{children}</div>;
}

function SubQ({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 mt-3 text-[13px] text-muted-foreground first:mt-0">{children}</div>;
}

function Next({ enabled, dispatch }: { enabled: boolean; dispatch: Dispatch }) {
  const t = useT();
  return (
    <div className="mt-3 flex justify-end">
      <Button variant="cta" size="lg" disabled={!enabled} onClick={() => dispatch({ type: "next" })}>
        {t("meals.next")}
      </Button>
    </div>
  );
}

function StepPanel({ id, s, dispatch }: { id: StepId; s: OnboardingState; dispatch: Dispatch }) {
  const t = useT();
  const a = s.answers;
  switch (id) {
    case "consent":
      return (
        <>
          <Panel>
            <dl className="m-0">
              {[
                [t("meals.consent.what"), t("meals.consent.whatValue")],
                [t("meals.consent.why"), t("meals.consent.whyValue")],
                [t("meals.consent.where"), t("meals.consent.whereValue")],
                [t("meals.consent.undo"), t("meals.consent.undoValue")],
              ].map(([dt, dd]) => (
                <div key={dt} className="mt-2.5 first:mt-0">
                  <dt className="text-[11px] font-medium uppercase tracking-wider text-faint-foreground">{dt}</dt>
                  <dd className="m-0 mt-0.5 text-[14px] leading-relaxed text-foreground">{dd}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <div className="mt-2.5">
            <Opts column>
              {CONSENT_OPTIONS.map((o) => (
                <Opt
                  key={o.value}
                  selected={a.consent === o.value}
                  label={o.label}
                  onClick={() => dispatch({ type: "consent", value: o.value })}
                />
              ))}
            </Opts>
          </div>
        </>
      );
    case "goal":
      return (
        <div className="mt-2.5">
          <Opts column>
            {GOAL_OPTIONS.map((o) => (
              <Opt
                key={o.value}
                selected={a.goal === o.value}
                label={o.label}
                sub={o.sub}
                onClick={() => dispatch({ type: "goal", value: o.value })}
              />
            ))}
          </Opts>
        </div>
      );
    case "body":
      return (
        <Panel>
          <Field title={t("meals.sex")}>
            <Opts>
              {SEX_OPTIONS.map((o) => (
                <Opt
                  key={o.value}
                  selected={a.sex === o.value}
                  label={o.label}
                  onClick={() => dispatch({ type: "sex", value: o.value })}
                />
              ))}
            </Opts>
          </Field>
          <Field title={t("meals.age")}>
            <Stepper field="age" value={String(a.age)} unit={t("meals.yearsUnit")} dispatch={dispatch} />
          </Field>
          <Field title={t("meals.height")}>
            <Stepper field="heightCm" value={String(a.heightCm)} unit="cm" dispatch={dispatch} />
          </Field>
          <Field title={t("meals.weight")}>
            <Stepper field="weightKg" value={a.weightKg.toFixed(1)} unit="kg" dispatch={dispatch} />
          </Field>
          <Field title={t("meals.bodyFatOptional")}>
            {a.bodyFatKnown && (
              <Stepper field="bodyFatPct" value={a.bodyFatPct.toFixed(1)} unit="%" dispatch={dispatch} />
            )}
            <div className="mt-2">
              <Opt
                selected={!a.bodyFatKnown}
                label={t("meals.bodyFatUnknown")}
                onClick={() => dispatch({ type: "flag", field: "bodyFatKnown" })}
              />
            </div>
          </Field>
          <Field title={t("meals.waistOptional")}>
            {a.waistKnown && (
              <Stepper field="waistCm" value={String(a.waistCm)} unit="cm" dispatch={dispatch} />
            )}
            <div className="mt-2">
              <Opt
                selected={a.waistKnown}
                label={t("meals.waistFill")}
                onClick={() => dispatch({ type: "flag", field: "waistKnown" })}
              />
            </div>
            <p className="m-0 mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {t("meals.waistHint")}
            </p>
          </Field>
          <Next enabled={stepDone(a, "body")} dispatch={dispatch} />
        </Panel>
      );
    case "train":
      return (
        <Panel>
          <SubQ>{t("meals.days")}</SubQ>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <Button
                key={d}
                variant="outline"
                size="lg"
                aria-pressed={a.trainingDays.includes(d)}
                className={cn(
                  "min-w-0 flex-1 bg-card px-0 text-[15px] font-normal text-foreground",
                  a.trainingDays.includes(d) && "border-secondary-border bg-secondary font-semibold",
                )}
                onClick={() => dispatch({ type: "toggleDay", day: d })}
              >
                {ZH_WEEKDAY[d]}
              </Button>
            ))}
          </div>
          <div className="mt-2">
            <Opt
              selected={a.noTraining && a.trainingDays.length === 0}
              label={t("meals.noTrainingNow")}
              onClick={() => dispatch({ type: "noTraining" })}
            />
          </div>
          {a.trainingDays.length > 0 && (
            <>
              <SubQ>{t("meals.when")}</SubQ>
              <Opts>
                {TRAIN_TIME_OPTIONS.map((o) => (
                  <Opt
                    key={o.value}
                    selected={a.trainTime === o.value}
                    label={o.label}
                    onClick={() => dispatch({ type: "trainTime", value: o.value })}
                  />
                ))}
              </Opts>
            </>
          )}
          <Next enabled={stepDone(a, "train")} dispatch={dispatch} />
        </Panel>
      );
    case "work":
      return (
        <div className="mt-2.5">
          <Opts column>
            {WORK_OPTIONS.map((o) => (
              <Opt
                key={o.value}
                selected={a.work === o.value}
                label={o.label}
                sub={o.sub}
                onClick={() => dispatch({ type: "work", value: o.value })}
              />
            ))}
          </Opts>
        </div>
      );
    case "logistics":
      return (
        <Panel>
          <SubQ>{t("meals.peopleQuestion")}</SubQ>
          <Opts>
            {PEOPLE_OPTIONS.map((o) => (
              <Opt
                key={o.value}
                selected={a.people === o.value}
                label={o.label}
                onClick={() => dispatch({ type: "people", value: o.value })}
              />
            ))}
          </Opts>
          <SubQ>{t("meals.shopWhereQuestion")}</SubQ>
          <Opts>
            {SHOP_OPTIONS.map((v) => (
              <Opt
                key={v}
                selected={a.shops.includes(v)}
                label={v}
                onClick={() => dispatch({ type: "toggle", field: "shops", value: v })}
              />
            ))}
          </Opts>
          <SubQ>{t("meals.kitchenQuestion")}</SubQ>
          <Opts>
            {KITCHEN_OPTIONS.map((v) => (
              <Opt
                key={v}
                selected={a.kitchen.includes(v)}
                label={v}
                onClick={() => dispatch({ type: "toggle", field: "kitchen", value: v })}
              />
            ))}
          </Opts>
          <SubQ>{t("meals.avoidQuestion")}</SubQ>
          <Opts>
            {AVOID_OPTIONS.map((o) => (
              <Opt
                key={o.label}
                selected={a.avoid.includes(o.label)}
                label={o.label}
                onClick={() => dispatch({ type: "toggle", field: "avoid", value: o.label })}
              />
            ))}
          </Opts>
          <p className="m-0 mt-2.5 text-[13px] leading-relaxed text-muted-foreground">{t("meals.otherAvoidHint")}</p>
          <Next enabled={stepDone(a, "logistics")} dispatch={dispatch} />
        </Panel>
      );
  }
}

function Result({
  s,
  onFinish,
}: {
  s: OnboardingState;
  onFinish: (profile: Profile) => Promise<boolean>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const profile = toProfile(s.answers);
  if (!profile) return null;
  const targets = computeTargets(profile, hostRegion());
  const finish = () => {
    setBusy(true);
    setFailed(false);
    void onFinish(profile).then((ok) => {
      setBusy(false);
      setFailed(!ok);
    });
  };
  return (
    <>
      <Ai>
        <p className="m-0 mb-1.5">{resultLine(targets, profile)}</p>
      </Ai>
      <TargetsCard summary={targetsSummary(targets, profile)} />
      {failed && (
        <p className="m-0 text-[13px] text-destructive">{t("meals.saveFailed")}</p>
      )}
      <div className="flex justify-end">
        <Button variant="cta" size="lg" disabled={busy} onClick={finish}>
          {t("meals.makeWeekPlan")}
        </Button>
      </div>
    </>
  );
}

export function MealsOnboarding(props: MealsOnboardingProps) {
  const t = useT();
  const [s, dispatch] = useReducer(onboardingReducer, props.existing, initialOnboarding);
  const current = useRef<HTMLDivElement | null>(null);

  // Bring the question being asked into view whenever the step moves.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    current.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [s.step]);

  const shown = STEPS.slice(0, Math.min(s.step, STEPS.length - 1) + 1);

  return (
    <MealsColumn>
      <MealsHeader title={t("meals.title")} onBack={props.onBack} />
      <div className="flex flex-col gap-3.5">
        <Ai>
          <p className="m-0">{INTRO_LINE}</p>
        </Ai>
        {shown.map((id, i) => (
          <div key={id} className="flex flex-col gap-3.5">
            <div ref={i === s.step ? current : undefined} className="scroll-mt-16">
              <Ai>
                <p className="m-0">{questionText(id)}</p>
              </Ai>
              {i === s.step && <StepPanel id={id} s={s} dispatch={dispatch} />}
            </div>
            {i < s.step && (
              <Button
                variant="ghost"
                size="lg"
                className="h-auto max-w-[86%] self-end whitespace-normal rounded-2xl bg-chat-bubble px-3.5 py-2 text-left text-[15px] font-normal text-foreground"
                onClick={() => dispatch({ type: "goto", step: i })}
              >
                {answerText(s.answers, id)}
              </Button>
            )}
            {i === s.step && id === "consent" && s.answers.consent === "no" && (
              <Ai>
                <p className="m-0">{NO_CONSENT_REPLY}</p>
              </Ai>
            )}
          </div>
        ))}
        {s.step >= RESULT_STEP && (
          <div ref={current} className="flex scroll-mt-16 flex-col gap-3.5">
            <Result s={s} onFinish={props.onFinish} />
          </div>
        )}
        {s.step > 0 && (
          <p className="m-0 text-center text-[12px] text-faint-foreground">{t("meals.tapToChange")}</p>
        )}
      </div>
    </MealsColumn>
  );
}
