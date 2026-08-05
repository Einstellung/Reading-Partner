// Delete confirmation for one talk, the same shape as the other two destructive
// dialogs in the library: the act runs from an AlertDialog's action, and the
// press that starts it is a row in the talk's menu, which is why the open state
// comes from outside instead of from a trigger of its own.

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../ui/alert-dialog";

export default function DeleteTalkButton(props: {
  name: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onDelete(): void;
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{props.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The talk goes, and with it the outline you settled. The books, their marks and their
            notes are untouched, and a deck already built stays where it was written.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={props.onDelete}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
