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

import { useT } from "../../../../i18n";
import { Button } from "../../ui/button";
import { Dialog, DialogSheetContent, DialogTitle } from "../../ui/dialog";

export default function PhoneLessonIntroSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: () => void;
  // Hand the file to another app instead. Absent = this build has no such door
  // and the button is not drawn.
  onOpenIn?: () => void;
}) {
  const t = useT();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogSheetContent>
        <DialogTitle className="border-b border-border-subtle px-4 py-3.5 text-[15px] font-semibold">
          {t("phone.lessonIntro.title")}
        </DialogTitle>
        <div className="overflow-y-auto p-4">
          <p className="m-0 mb-3 text-[15px] leading-[1.55]">{t("phone.lessonIntro.body1")}</p>
          <p className="m-0 mb-3 text-[15px] leading-[1.55] text-muted-foreground">
            {t("phone.lessonIntro.body2")}
          </p>
          <p className="m-0 text-[15px] leading-[1.55] text-muted-foreground">
            {t("phone.lessonIntro.body3")}
          </p>
        </div>
        <div className="flex flex-col gap-2.5 px-4 pt-1 pb-safe-4">
          <Button variant="default" size="lg" className="w-full" onClick={props.onStart}>
            {t("phone.lessonIntro.start")}
          </Button>
          {props.onOpenIn && (
            <Button variant="outline" size="lg" className="w-full" onClick={props.onOpenIn}>
              {t("phone.lessonIntro.openIn")}
            </Button>
          )}
        </div>
      </DialogSheetContent>
    </Dialog>
  );
}
