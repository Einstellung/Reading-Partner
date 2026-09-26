// Naming a new topic on the phone: the desk's name dialog (common/NameDialog.tsx)
// in the phone's bottom sheet. Same title, sentence and placeholder; a form, so
// the keyboard's key and Enter both submit.
//
// The field is focused by the caller inside the tap that opened the sheet
// (PhoneShelf.tsx): iOS raises the keyboard only for a focus that happens during
// a user gesture, and Radix's own autofocus runs after it.

import { useState, type MutableRefObject } from "react";
import { NEW_TOPIC_BLURB, NEW_TOPIC_PLACEHOLDER } from "../shelf/topic-shelf";
import { Button } from "../ui/button";
import { Dialog, DialogDescription, DialogSheetContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";

export default function NewTopicSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => void;
  inputRef: MutableRefObject<HTMLInputElement | null>;
}) {
  const [name, setName] = useState("");
  const trimmed = name.trim();

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) setName("");
        props.onOpenChange(open);
      }}
    >
      {/* One track no wider than the sheet: the content is a grid, and an
          implicit auto column grows to fit a long unbroken name. */}
      <DialogSheetContent
        className="grid-cols-[minmax(0,1fr)]"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          props.inputRef.current?.focus({ preventScroll: true });
        }}
      >
        <DialogTitle className="border-b border-border-subtle px-4 py-3 text-[15px]">
          New topic
        </DialogTitle>
        <form
          className="flex min-w-0 flex-col gap-4 px-4 pt-4 pb-safe-4"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            if (!trimmed) return;
            props.onCreate(trimmed);
            setName("");
          }}
        >
          <DialogDescription>{NEW_TOPIC_BLURB}</DialogDescription>
          <Input
            ref={props.inputRef}
            value={name}
            placeholder={NEW_TOPIC_PLACEHOLDER}
            aria-label="Topic name"
            enterKeyHint="done"
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={!trimmed}>
              Create
            </Button>
          </div>
        </form>
      </DialogSheetContent>
    </Dialog>
  );
}
