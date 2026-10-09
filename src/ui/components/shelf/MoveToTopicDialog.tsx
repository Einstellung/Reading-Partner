// "Move to…": the topics a file can go to (move-to.ts). Off the bottom edge in
// the phone shell, the box the lesson's chapter list comes out of
// (PhoneChapterSheet); centred on the desk. A pick is the move, with no
// confirmation: the file is one more pick from where it was.

import { useT } from "../../../i18n";
import { cn } from "../lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogSheetContent,
  DialogTitle,
} from "../ui/dialog";
import type { MoveTarget } from "./move-to";

export default function MoveToTopicDialog(props: {
  open: boolean;
  fileName: string;
  targets: readonly MoveTarget[];
  // Off the bottom edge (the phone shell) rather than centred.
  sheet?: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (target: MoveTarget) => void;
}) {
  const t = useT();
  const Content = props.sheet ? DialogSheetContent : DialogContent;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <Content className={props.sheet ? undefined : "gap-0 overflow-hidden p-0 sm:max-w-md"}>
        <div className="min-w-0 border-b border-border-subtle px-4 py-3">
          <DialogTitle className="text-[15px]">{t("library.move.title")}</DialogTitle>
          <DialogDescription className="mt-1.5 truncate text-[12px] leading-4 text-faint-foreground">
            {props.fileName}
          </DialogDescription>
        </div>
        <ul className="m-0 list-none overflow-y-auto p-0 pb-safe-4">
          {props.targets.map((target) => (
            <li key={target.id}>
              <button
                disabled={target.here}
                className="flex min-h-11 w-full items-center gap-2.5 border-0 bg-transparent px-4 py-2 text-left coarse:min-h-[52px] can-hover:hover:bg-muted active:bg-muted disabled:cursor-default disabled:bg-transparent"
                onClick={() => props.onPick(target)}
              >
                <span
                  className={cn(
                    "min-w-0 flex-1 text-[15px] leading-5 [overflow-wrap:anywhere]",
                    target.here && "text-muted-foreground",
                  )}
                >
                  {target.name}
                </span>
                {target.here ? (
                  <span className="flex-none text-[11px] font-medium tracking-[0.08em] text-accent-line uppercase">
                    {t("library.move.here")}
                  </span>
                ) : (
                  <span className="flex-none text-[12px] text-faint-foreground [font-variant-numeric:tabular-nums]">
                    {target.count}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </Content>
    </Dialog>
  );
}
