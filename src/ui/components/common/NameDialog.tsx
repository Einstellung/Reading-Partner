// Naming something, for both the times it happens: creating it and renaming it.
// A topic and a retell both use it. A dialog rather than a field on the shelf — a
// name is given once and changed once more at most, and a permanent text box was
// the loudest thing on a screen that is supposed to be about the books.
//
// No DialogTrigger: the caller mounts this only while it is open, which is also
// what resets the field between two uses.

import { useState } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

export default function NameDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  placeholder?: string;
  confirmLabel: string;
  initialValue?: string;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState(props.initialValue ?? "");
  const trimmed = name.trim();

  const commit = () => {
    if (!trimmed) return;
    props.onConfirm(trimmed);
    props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* The width is the caller's and it is a `w-*`: max-width belongs to the
          safe-area utility alone (docs/30). */}
      <DialogContent className="w-[min(26rem,100%)]">
        <DialogHeader>
          <DialogTitle className="leading-normal">{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        {/* A form, so the on-screen keyboard offers Go and Enter submits. */}
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
        >
          <Input
            autoFocus
            value={name}
            placeholder={props.placeholder}
            onChange={(e) => setName(e.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed}>
              {props.confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
