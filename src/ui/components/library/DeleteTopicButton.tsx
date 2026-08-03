// Delete confirmation for a topic. Deleting a topic drops the reading list it
// stands for, so it is never one press: the delete runs from an AlertDialog's
// action, the same shape as DeleteThreadButton.
//
// The press that starts it is the card menu's Delete row (TopicCard), which is
// why the open state comes from outside instead of from a trigger of its own: a
// menu row cannot be the trigger, because picking it closes the menu and takes
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

interface DeleteTopicButtonProps {
  topicName: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onDelete(): void;
}

export default function DeleteTopicButton({
  topicName,
  open,
  onOpenChange,
  onDelete,
}: DeleteTopicButtonProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{topicName}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The topic and its reading list go. The files stay on disk.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onDelete}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
