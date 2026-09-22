// Said once, the first time a PDF is tapped on this phone (docs/70): this card
// does not open the pages, it opens a lesson.
//
// It is a sheet and not a toast because it has a choice in it — the reader who
// wanted the pages themselves is offered the other app right here — and because
// a line that explains a screen the reader has never seen has to be readable
// before the screen appears behind it.
//
// Seen-ness is this machine's (DeviceSettings.lessonIntroSeen) and does not
// sync: the sentence explains what this phone does with a tap, and an iPad has
// nothing to learn from it.

import { Button } from "../ui/button";
import { Dialog, DialogSheetContent, DialogTitle } from "../ui/dialog";

export default function PhoneLessonIntroSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: () => void;
  // Hand the file to another app instead. Absent = this build has no such door
  // and the button is not drawn.
  onOpenIn?: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogSheetContent>
        <DialogTitle className="border-b border-border-subtle px-4 py-3.5 text-[15px] font-semibold">
          This one opens as a lesson
        </DialogTitle>
        <div className="overflow-y-auto p-4">
          <p className="m-0 mb-3 text-[15px] leading-[1.55]">
            On the phone a PDF is not turned page by page. It opens as a lesson: I take you through
            the paper in text, quoting it with page numbers as we go.
          </p>
          <p className="m-0 mb-3 text-[15px] leading-[1.55] text-muted-foreground">
            To see the pages themselves — the figures, the tables, the typesetting — hand the file
            to another app with Open in…, or read it on the iPad.
          </p>
          <p className="m-0 text-[15px] leading-[1.55] text-muted-foreground">
            Said once. Next time this card goes straight into the lesson.
          </p>
        </div>
        <div className="flex flex-col gap-2.5 px-4 pt-1 pb-safe-4">
          <Button variant="default" size="lg" className="w-full" onClick={props.onStart}>
            Start the lesson
          </Button>
          {props.onOpenIn && (
            <Button variant="outline" size="lg" className="w-full" onClick={props.onOpenIn}>
              Open in…
            </Button>
          )}
        </div>
      </DialogSheetContent>
    </Dialog>
  );
}
