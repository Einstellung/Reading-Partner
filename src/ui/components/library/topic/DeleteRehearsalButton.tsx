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
            Every pass over this talk goes with it. The talk itself stays where it is, and you can
            rehearse it again from the retell.
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
