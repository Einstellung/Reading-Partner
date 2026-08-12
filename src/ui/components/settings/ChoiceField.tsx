// A labelled dropdown: the shape every choice in Settings takes. One place, so
// the four of them cannot drift in chrome, in row height, or in what the empty
// state looks like.
//
// The label names the trigger by id instead of wrapping it — the one place in
// this app that does. A <button> is a labelable element, so a wrapping <label>
// takes the trigger as its labeled control and forwards a synthetic click to it
// for every click that lands in the label but outside the button; on touch that
// is the same event Radix's Select opens on, and the pairing is a reported
// defect upstream (radix-ui/primitives#3679). aria-label stays on the trigger,
// which is role="combobox" rather than a form control.
//
// The field owns no box of its own: it emits the label and the trigger as two
// cells, and FieldGrid around it is the row. That is what makes two fields in
// one card line up — a per-field flex row would start each trigger after its own
// label, and "Provider" and "Model" are not the same width.

import { useId } from "react";

import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

export interface Choice {
  value: string;
  label: string;
}

// The rows one or more ChoiceFields stand in: a label column as wide as the
// widest label, and a control column as wide as the widest control. `w-fit`
// keeps the pair at its content width so a two-option dropdown is not stretched
// across the card; `max-w-full` is what stops a long model name from pushing the
// grid past the card it sits in.
export function FieldGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid w-fit max-w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
      {children}
    </div>
  );
}

export function ChoiceField({
  label,
  value,
  choices,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  // Undefined, not "", for nothing chosen: Radix reserves the empty string and
  // shows the placeholder instead of a row the user can pick.
  value: string | undefined;
  choices: Choice[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const triggerId = useId();

  return (
    <>
      <Label layout="detached" htmlFor={triggerId}>
        {label}
      </Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={triggerId} aria-label={label}>
          {/* A native <select> is as wide as its widest option and does not
              resize when the value changes. Radix's trigger holds only the
              chosen label, so the width is reserved here: every label is laid
              into the same grid cell, zero-height and invisible, and the column
              takes the widest of them. Measuring the strings instead would have
              to guess at the font. */}
          <span className="grid min-w-0 flex-1 text-left">
            <span className="col-start-1 row-start-1 truncate">
              <SelectValue placeholder={placeholder} />
            </span>
            {choices.map((c) => (
              <span
                key={c.value}
                aria-hidden
                className="col-start-1 row-start-1 h-0 overflow-hidden whitespace-nowrap invisible"
              >
                {c.label}
              </span>
            ))}
          </span>
        </SelectTrigger>
        <SelectContent>
          {choices.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
