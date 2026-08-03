// Remove confirmation for one book in a topic, the same shape as
// DeleteTopicButton: the act runs from an AlertDialog's action, and the press
// that starts it is a row in the card's menu, which is why the open state comes
// from outside instead of from a trigger of its own.
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

interface RemoveFileButtonProps {
  title: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onRemove(): void;
}

export default function RemoveFileButton({
  title,
  open,
  onOpenChange,
  onRemove,
}: RemoveFileButtonProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove “{title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The topic loses the book. The file stays on disk, and so do its reading position and
            marks — adding it back brings them with it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onRemove}>
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
