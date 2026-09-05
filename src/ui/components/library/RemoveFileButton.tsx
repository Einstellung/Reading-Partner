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
  // Whether this topic holds the last reference to the book
  // (reading/delete/pick.ts). It decides which of the two acts this is: taking
  // the book out of one topic while another still has it, or deleting it.
  lastReference: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  onRemove(): void;
}

export default function RemoveFileButton({
  title,
  lastReference,
  open,
  onOpenChange,
  onRemove,
}: RemoveFileButtonProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {lastReference ? `Delete “${title}”?` : `Remove “${title}”?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {lastReference
              ? "Delete this book and everything about it? Your notes about yourself stay."
              : "The topic loses the book. The file stays on disk, and so do its reading position and marks — adding it back brings them with it."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onRemove}>
            {lastReference ? "Delete" : "Remove"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
