// A topic's articles, as rows. Opening one is the same tap that opens a book and
// removing one is the same affordance a card offers; what is missing is the
// cover, because a web article has none (docs/67).
//
// What each row says is in article-row.ts. This file only draws it.

import { Button } from "../ui/button";
import { ROW, ROW_LIST, ROW_NAME } from "./cardStyles";
import type { ArticleRow } from "./article-row";

export default function ArticleRows(props: {
  rows: ArticleRow[];
  // Set when cards are drawn above these rows, which is the only time the list
  // needs room over it.
  underCards?: boolean;
  onOpen: (row: ArticleRow) => void;
  onRemove: (row: ArticleRow) => void;
}) {
  if (props.rows.length === 0) return null;
  return (
    <ul className={`${ROW_LIST}${props.underCards ? " mt-4" : ""}`}>
      {props.rows.map((row) => (
        <li key={row.file.path} className={ROW}>
          <button className={ROW_NAME} onClick={() => props.onOpen(row)}>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate">{row.title}</span>
              {row.line !== "" && <span className="text-xs text-muted-foreground">{row.line}</span>}
            </span>
          </button>
          <div className="flex gap-1">
            <Button variant="destructive-outline" size="sm" onClick={() => props.onRemove(row)}>
              Remove
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
