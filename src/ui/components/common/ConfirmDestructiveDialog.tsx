// Confirmation for a delete started from a menu row: a topic, a book in a topic,
// a retell, a rehearsal. The act runs from the AlertDialog's action, never from
// the press that opened it.
//
// The open state comes from outside instead of from a trigger of its own: a menu
// row cannot be the trigger, because picking it closes the menu and takes
// everything portalled under it — the dialog included — down with it.
//
// Not window.confirm. Under Tauri the dialog plugin replaces it with a
// promise-returning version, so `!confirm(...)` is false whatever the answer and
// the guard never runs; the call is also outside the capability's ACL and
// rejects with nothing to catch it (docs/pitfall/98).

import type { ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";

export default function ConfirmDestructiveDialog(props: {
  title: string;
  description: string;
  // "Delete" unless the act is something milder, like taking a book out of one
  // topic while another still has it.
  actionLabel?: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
  // Anything the confirmation shows between its sentence and its buttons: a
  // topic's files that could go with it, and the box that says whether they do.
  children?: ReactNode;
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* One track no wider than the dialog: the content is a grid, and its
          implicit auto column grows to fit a long unbreakable title and pushes
          the dialog off a phone screen. */}
      <AlertDialogContent className="grid-cols-[minmax(0,1fr)]">
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {props.children}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={props.onConfirm}>
            {props.actionLabel ?? "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
