// Delete confirmation for one rehearsal, the same shape as the other destructive
// dialogs in the library: the act runs from an AlertDialog's action, and the
// press that starts it is a row in the rehearsal's menu, which is why the open
// state comes from outside instead of from a trigger of its own.

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

export default function DeleteRehearsalButton(props: {
  name: string;
  // Whether this deck is the app's own copy of one brought in from outside. A
  // deck the slides pipeline built belongs to its retell and stays where it is.
  imported: boolean;
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
            {props.imported
              ? "Every rehearsal of this deck goes, and so does this app's copy of the deck. Your own file is untouched."
              : "Every rehearsal of this deck goes. The retell and the deck it built stay where they are, and you can rehearse it again from there."}
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
