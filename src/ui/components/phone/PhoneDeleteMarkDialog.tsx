// Delete confirmation for a phone mark that has a conversation on it
// (delete-mark.ts): the conversation goes with the mark, so it is not one press.
// A mark without one still deletes from the popup directly. Opened after the
// popup has closed, so it sits on the dialog layer and nothing covers Cancel
// (docs/pitfall/211).

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

export default function PhoneDeleteMarkDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onDelete(): void;
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this mark?</AlertDialogTitle>
          <AlertDialogDescription>
            The mark goes, and with it the conversation opened from it. This cannot be undone.
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
