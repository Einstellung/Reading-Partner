// Remove confirmation for one source, the same shape as the library's
// destructive dialogs: the act runs from an AlertDialog's action, and the press
// that starts it is the row's ✕, which is why the open state comes from outside
// instead of from a trigger of its own.

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

export default function RemoveSourceButton(props: {
  name: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onRemove(): void;
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove “{props.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Nothing more is collected from it. To follow it again, tell the AI about it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={props.onRemove}>
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
