// Starting a talk: which of the topic's materials it is about.
//
// It opens with the marked ones already ticked (docs/31: 新建时不从零勾选) so the
// common case is one press. A material with no book id yet — added to the topic
// but never opened — is not offered: there is nothing on disk under it to
// retell from.

import { useState } from "react";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { defaultMaterialSelection, type MaterialCandidate } from "../../../../reading/retell";

export default function NewTalkDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: MaterialCandidate[];
  onConfirm: (bookIds: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>(() =>
    defaultMaterialSelection(props.candidates),
  );
  const toggle = (bookId: string) =>
    setPicked((cur) =>
      cur.includes(bookId) ? cur.filter((id) => id !== bookId) : [...cur, bookId],
    );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="w-[min(30rem,100%)]">
        <DialogHeader>
          <DialogTitle className="leading-normal">New talk</DialogTitle>
          <DialogDescription>
            A talk is prepared by going through what you read, chapter by chapter, and settling what
            it contributes. Pick what it is about.
          </DialogDescription>
        </DialogHeader>

        {props.candidates.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">
            Nothing to retell yet — open a book in this topic first.
          </p>
        ) : (
          <ul className="m-0 flex max-h-[50vh] list-none flex-col gap-1 overflow-y-auto p-0">
            {props.candidates.map((c) => (
              <li key={c.bookId}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 can-hover:hover:bg-muted coarse:min-h-[44px]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 flex-none accent-primary"
                    checked={picked.includes(c.bookId)}
                    onChange={() => toggle(c.bookId)}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{c.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.marks} mark{c.marks === 1 ? "" : "s"}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={picked.length === 0}
            onClick={() => {
              props.onConfirm(picked);
              props.onOpenChange(false);
            }}
          >
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
