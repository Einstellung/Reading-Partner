// The lines on the Today screen (docs/51), minus React. Every one of them is
// computed from something already on disk — a reading position, an annotation
// file. Nothing here goes through the model: a sentence a model wrote about what
// you are reading is a sentence that can be wrong about a number the app already
// knows (memory: no facts through the model).

import type { BookMeta } from "./file-title";
import { formatDateTime, t } from "../../../i18n";

// The date above the heading, in the app's own language. No year: the screen is
// called Today.
export function todayDateLine(now: Date): string {
  return formatDateTime(now, { weekday: "long", day: "numeric", month: "long" });
}

// The line under a Continue reading title: which question the book is read
// against, where the reader left off, and how much of it is marked. A book that
// was never opened contributes neither of the last two, so the line is just the
// topic — which is still worth saying.
export function continueMetaLine(topicName: string, meta: BookMeta | undefined): string {
  const parts = [topicName];
  if (meta?.page) {
    parts.push(
      meta.pages ? t("shell.today.pageOf", { page: meta.page, pages: meta.pages }) : t("shell.today.page", { page: meta.page }),
    );
  }
  if (meta?.marks) parts.push(t("shell.today.marks", { count: meta.marks }));
  return parts.join(" · ");
}
