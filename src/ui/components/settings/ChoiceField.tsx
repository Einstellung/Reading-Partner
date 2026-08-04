// A labelled dropdown: the shape every choice in Settings takes. One place, so
// the four of them cannot drift in chrome, in row height, or in what the empty
// state looks like.
//
// The label names the trigger by id instead of wrapping it — the one place in
// this app that does. A <button> is a labelable element, so a wrapping <label>
// takes the trigger as its labeled control and forwards a synthetic click to it
// for every click that lands in the label but outside the button; on touch that
// is the same event Radix's Select opens on, and the pairing is a reported
// defect upstream (radix-ui/primitives#3679). The row is the row it was: the
// flex box moved off the <label> onto a <div> around it. aria-label stays on the
// trigger, which is role="combobox" rather than a form control.

import { useId } from "react";

import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

export interface Choice {
  value: string;
  label: string;
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
    <div className="flex items-center gap-2">
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
    </div>
  );
}
