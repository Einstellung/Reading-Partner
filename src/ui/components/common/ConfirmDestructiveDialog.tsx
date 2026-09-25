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
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
        </AlertDialogHeader>
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
