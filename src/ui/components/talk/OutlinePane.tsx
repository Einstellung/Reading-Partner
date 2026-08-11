// The outline beside the rehearsal (docs/31, "界面"): the talk as it stands, one
// entry per chapter that has been settled, in the order it will be given.
//
// It is not a read-out of the conversation — it is the same data the AI writes
// and reads, so moving an entry or cutting it changes what the AI sees on the
// next turn. Reordering is two buttons rather than a drag: a drag needs a
// pointer contract that touch, Pencil and the dropdown layer all agree on, and
// an outline is a dozen rows.

import { IconClose } from "../common/icons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import type { OutlineRow } from "../../../reading/talks";

const MENU_ROW =
  "w-full rounded-md px-2.5 py-0 text-left text-[13px] min-h-[36px] coarse:min-h-[44px] cursor-pointer";

export interface OutlinePaneProps {
  rows: OutlineRow[];
  onMove(index: number, delta: number): void;
  onSetIncluded(bookId: string, chapter: number, include: boolean): void;
  onRemove(bookId: string, chapter: number): void;
  onClose(): void;
}

export default function OutlinePane({
  rows,
  onMove,
  onSetIncluded,
  onRemove,
  onClose,
}: OutlinePaneProps) {
  return (
    <aside className="flex h-full w-[300px] flex-none flex-col border-l border-border bg-white">
      <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex-1 text-[13px] font-medium">The talk so far</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Hide the outline"
          aria-label="Hide the outline"
          onClick={onClose}
          className="h-8 w-8 text-muted-foreground"
        >
          <IconClose size={16} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {rows.length === 0 ? (
          <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">
            Nothing settled yet. As you go through a chapter and agree what it contributes, it lands
            here — and you can reorder or cut it.
          </p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {rows.map((row, i) => (
              <li
                key={row.key}
                className={
                  "rounded-lg border border-border p-2.5 " + (row.include ? "" : "bg-muted/40")
                }
              >
                <div className="flex items-start gap-1.5">
                  <span className="mt-0.5 w-5 flex-none text-[12px] tabular-nums text-muted-foreground">
                    {row.position ?? "—"}
                  </span>
                  <div className="min-w-0 flex-1">
                    {row.bookLabel && (
                      <div className="truncate text-[11px] text-muted-foreground">
                        {row.bookLabel}
                      </div>
                    )}
                    <div
                      className={
                        "text-[13px] leading-snug " +
                        (row.include ? "text-foreground" : "text-muted-foreground line-through")
                      }
                    >
                      {row.title}
                    </div>
                  </div>
                  <div className="flex flex-none items-center gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      title="Move up"
                      aria-label={`Move "${row.title}" up`}
                      disabled={i === 0}
                      onClick={() => onMove(i, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      title="Move down"
                      aria-label={`Move "${row.title}" down`}
                      disabled={i === rows.length - 1}
                      onClick={() => onMove(i, 1)}
                    >
                      ↓
                    </Button>
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground"
                          title={`Actions for "${row.title}"`}
                          aria-label={`Actions for "${row.title}"`}
                        >
                          ⋯
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className={MENU_ROW}
                          onSelect={() => onSetIncluded(row.bookId, row.chapter, !row.include)}
                        >
                          {row.include ? "Cut from the talk" : "Put back in the talk"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className={`${MENU_ROW} text-destructive focus:text-destructive`}
                          onSelect={() => onRemove(row.bookId, row.chapter)}
                        >
                          Remove the entry
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {row.points.length > 0 && (
                  <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0 pl-6">
                    {row.points.map((p, n) => (
                      <li
                        key={n}
                        className="flex items-start gap-1.5 text-[12px] leading-snug text-muted-foreground"
                      >
                        <span className="mt-1.5 h-1 w-1 flex-none rounded-full bg-border" />
                        <span className="min-w-0 flex-1">{p}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {row.figure && (
                  <div className="mt-1.5 pl-6">
                    <Badge className="shrink-0">Figure: {row.figure}</Badge>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
