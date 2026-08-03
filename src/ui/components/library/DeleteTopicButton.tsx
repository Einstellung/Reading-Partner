// Delete control for a topic row. Deleting a topic drops the reading list it
// stands for, so it is never one press: the button opens an AlertDialog and the
// delete runs from the dialog's action, the same shape as DeleteThreadButton.
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
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";

interface DeleteTopicButtonProps {
  topicName: string;
  onDelete(): void;
}

export default function DeleteTopicButton({ topicName, onDelete }: DeleteTopicButtonProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive-outline" size="sm">
          Delete
        </Button>
      </AlertDialogTrigger>
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
