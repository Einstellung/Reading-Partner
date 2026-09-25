// Remove confirmation for one saved article, the same shape as the other
// destructive dialogs in the library: the act runs from an AlertDialog's action,
// and the press that starts it is the row's Remove, which is why the open state
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
} from "../ui/alert-dialog";

export default function RemoveSavedArticleButton(props: {
  title: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onRemove(): void;
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove “{props.title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The article leaves your saved articles. Saving it again from a briefing brings it back.
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
