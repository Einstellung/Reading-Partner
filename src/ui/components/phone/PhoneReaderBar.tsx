// The phone reader's top bar (docs/70). The desk's ReaderTopBar is built for a
// window with a sidebar, a zoom group and an overflow menu; this is the same
// controls a phone has room for, in one line: the way back, the book, where the
// reader is in it, the outline, the pen rack, and the AI entry that is dim.
//
// The two dim controls wear the treatment ReaderTopBar gives the blackboard
// when a level is closed: drawn, disabled, and carrying the reason as its title
// and in its accessible name. Same PenToolbar, same `disabled` map.

import { ANNOTATION_COLORS } from "../../../platform/app/annotations";
import type { ViewStats } from "../../../platform/app/reader-contract";
import { IconBookSparkle, IconOutline } from "../base/icons";
import PenToolbar from "../reader/PenToolbar";
import { readerPageText } from "../reader/reader-page-text";
import type { Tool } from "../reader/types";
import { Button } from "../ui/button";
import { AI_NOT_ON_PHONE, NO_PAGES_TO_LOCK } from "./reader-gate";

const BOOK_THREAD = "Learn this book with AI";

export default function PhoneReaderBar(props: {
  title: string;
  // The cutting line while the pages are being laid out, or null.
  status: string | null;
  stats: ViewStats | null;
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  onBack: () => void;
  onOutline: () => void;
}) {
  const pageText = readerPageText(props.stats);
  return (
    <div className="flex flex-none flex-col gap-0.5 border-b border-border-subtle px-1 pt-1 pb-1">
      <div className="flex items-center gap-1">
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
        <span className="flex-none [font-variant-numeric:tabular-nums] px-1 text-[12px] whitespace-nowrap text-muted-foreground">
          {props.status ?? pageText.blocks}
          {!props.status && pageText.printed && (
            <span className="ml-1.5 text-faint-foreground">{pageText.printed}</span>
          )}
        </span>
      </div>

      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="flex-none text-muted-foreground"
          title="Outline"
          aria-label="Outline"
          onClick={props.onOutline}
        >
          <IconOutline size={20} />
        </Button>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <PenToolbar
            orientation="horizontal"
            tool={props.tool}
            colors={ANNOTATION_COLORS}
            onToolChange={props.onToolChange}
            disabled={{ ai: AI_NOT_ON_PHONE, navlock: NO_PAGES_TO_LOCK }}
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="flex-none text-muted-foreground"
          disabled
          title={AI_NOT_ON_PHONE}
          aria-label={`${BOOK_THREAD}: ${AI_NOT_ON_PHONE}`}
          onClick={() => {}}
        >
          <IconBookSparkle size={20} />
        </Button>
      </div>
    </div>
  );
}
