// Delete control for a chat header (docs/03). Deleting a conversation is
// destructive and takes the mark it hangs on with it, so it is never one press:
// the trash icon opens an AlertDialog and the delete runs from the dialog's
// action. That replaces an inline two-step (press once to arm, again to
// confirm), which said the same thing with less of it on screen and nothing to
// read.
//
// Nothing hangs off focus here. The two-step had to grow a document-level
// pointerdown listener because WebKit does not focus a button when it is tapped
// and the arming state came undone on blur — docs/pitfall/67. Radix moves focus
// into the dialog and traps it there; dismissal is Escape, Cancel, or the
// action.

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
} from '../ui/alert-dialog';
import { Button } from '../ui/button';
import { IconTrash } from '../common/icons';

interface DeleteThreadButtonProps {
	onDelete(): void;
}

export default function DeleteThreadButton({ onDelete }: DeleteThreadButtonProps) {
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					title="Delete conversation"
					aria-label="Delete conversation"
					className="h-6 w-6 text-neutral-400 can-hover:hover:bg-red-700/10 can-hover:hover:text-red-700"
				>
					<IconTrash size={15} />
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
					<AlertDialogDescription>
						The conversation goes, and with it the mark it was opened from. This cannot be undone.
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
