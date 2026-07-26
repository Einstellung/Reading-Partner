// What the reader is told when a book will not open.
//
// A failed open has no second act: the engine reports it once, the reading area
// stays an empty grey rectangle for good, and nothing else ever fires. Left
// unsaid, that is indistinguishable from a slow load — the status line goes on
// claiming the book is rendering while it never will. So the failure gets said
// in words, and says which book.
//
// The engine's own text ("Invalid PDF structure", a PDFium code, a stack) is
// worth having in a bug report and is no explanation to a reader, so it goes to
// the console and never into the sentence they are handed.

export interface OpenFailureText {
  // The reader's status line, which was until now saying "Rendering…".
  status: string;
  // The toast: which book, and that it could not be opened. Toasts expire, so
  // this one names the book — the status line beside the title is the part that
  // stays.
  toast: string;
  // The console line. Carries the engine's text, which nothing else does.
  detail: string;
}

// Whatever the engine threw, as a line of text. Anything can arrive here: the
// plugins reject with Error, with a bare string, and with task objects carrying
// a `reason`.
export function engineErrorText(error: unknown): string {
  if (error === null || error === undefined) return "no error given";
  if (typeof error === "string") return error.trim() || "no error given";
  if (error instanceof Error) return error.message.trim() || error.name;
  const bag = error as { message?: unknown; reason?: unknown };
  for (const field of [bag.message, bag.reason]) {
    if (typeof field === "string" && field.trim()) return field.trim();
  }
  return String(error);
}

export function openFailureText(bookName: string, error: unknown): OpenFailureText {
  const name = bookName.trim();
  const which = name ? `“${name}”` : "this book";
  return {
    status: "Couldn't be opened",
    toast: `Couldn't open ${which} — the file may be damaged, or not a PDF.`,
    detail: `failed to open ${which}: ${engineErrorText(error)}`,
  };
}
