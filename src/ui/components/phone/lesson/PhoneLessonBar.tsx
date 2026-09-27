// The lesson screen's top bar (docs/70): the way back, the paper, the chapters,
// and the door to another app. One line, the phone reader's bar minus everything
// a lesson has no pages for — no pen rack, no page count, no display sheet.
//
// There is no overflow menu and nothing to restart. A lesson is the book-level
// conversation, and the one thing a menu would have offered — hand this file to
// another app — is short enough to be its own icon.

import { IconOutline, IconShareOut } from "../../base/icons";
import { Button } from "../../ui/button";

export default function PhoneLessonBar(props: {
  title: string;
  onBack: () => void;
  onChapters: () => void;
  // Hand the file to another app. Absent = this build has no such door (Android,
  // and any iOS build without the plugin), and the icon is not drawn — an
  // control that cannot do anything is worse than none (docs/70).
  onOpenIn?: () => void;
}) {
  return (
    <div className="flex flex-none items-center gap-1 border-b border-border-subtle px-1 py-1">
      <Button
        variant="ghost"
        size="icon"
        className="flex-none text-muted-foreground"
        title="Back to the shelf"
        aria-label="Back to the shelf"
        onClick={props.onBack}
      >
        ‹
      </Button>
      <span className="min-w-0 flex-1 truncate font-display text-[15px] font-medium text-foreground">
        {props.title}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="flex-none text-muted-foreground"
        title="Chapters"
        aria-label="Chapters"
        onClick={props.onChapters}
      >
        <IconOutline size={20} />
      </Button>
      {props.onOpenIn && (
        <Button
          variant="ghost"
          size="icon"
          className="flex-none text-muted-foreground"
          title="Open in…"
          aria-label="Open in…"
          onClick={props.onOpenIn}
        >
          <IconShareOut size={20} />
        </Button>
      )}
    </div>
  );
}
