// Reader: the open book — top bar, annotation tools, the left sidebar (Outline,
// Marks, Prep), the reading-side chat cards, and the reader's own tool status
// and error lines under reading/ingest, reading/translate, reading/replace and
// reading/engine. The source every other locale is typed against.

export default {
  // AnnotationPopup: the small editor that opens on an existing mark.
  "popup.title": "Annotation",
  "popup.close": "Close",
  "popup.commentPlaceholder": "Add a comment",
  "popup.delete": "Delete",

  // StatusPill: the running/done line at the bottom of the reader.
  "status.dismiss": "Dismiss",

  // MoreMenu: the top bar's overflow.
  "more.button": "More",
  "more.buttonAlert": "More — sync needs attention",
  "more.on": "On",
  "more.off": "Off",

  // PenToolbar: the annotation tool rack.
  "pen.navigateOnly": "Navigate only",
  "pen.highlight": "Highlight",
  "pen.aiPen": "AI pen",
  "pen.toolsLabel": "Reading tools",
  "pen.disabledReason": "{label}: {reason}",

  // ReaderTopBar.
  "top.learnBook": "Learn this book with AI",
  "top.zoomIn": "Zoom in",
  "top.zoomOut": "Zoom out",
  "top.pagedFlip": "Paged flip",
  "top.lumen": "Lumen",
  "top.settings": "Settings",
  "top.closePanel": "Close panel",
  "top.openPanel": "Open panel",
  "top.backToLibrary": "Back to library",
  "top.library": "Library",

  // The page indicator, and the More menu's zoom-reset item.
  "page.blocks": "{index} / {count}",
  "page.printed": "printed {label}",
  "zoom.fitPage": "Fit page",
  "zoom.fitPageWidth": "Fit page width",

  // Sidebar: the tab row.
  "sidebar.outline": "Outline",
  "sidebar.marks": "Marks",
  "sidebar.prep": "Prep",

  // OutlineView.
  "outline.loading": "Reading the outline…",
  "outline.emptyDocument": "This document has no outline.",
  "outline.emptyBook": "This book has no table of contents.",

  // TraceList: every mark left on the book.
  "trace.groupPage": "On the page",
  "trace.groupChat": "In the classroom",
  "trace.list": "Traces",
  "trace.confirmDelete": "Confirm delete",
  "trace.delete": "Delete",
  "trace.page": "Page {label}",
  "trace.openThread": "Open AI thread",
  "trace.deleteMark": "Delete mark",

  // PrepPanel: papers and chapters.
  "prep.waitingToPlan": "Waiting to plan…",
  "prep.planFailed": "Plan failed: {error}",
  "prep.retry": "Retry",
  "prep.rateLimited": "rate-limited, retrying later",
  "prep.skip": "Skip",
  "prep.loadingNote": "Loading note…",
  "prep.noNoteYet": "No note yet — the paper hasn't been digested.",
  "prep.referencedPapers": "Referenced papers",
  "prep.replan": "Replan",
  "prep.readingReferences": "Reading this document's references…",
  "prep.papersReady": "{done} of {total} papers ready",
  "prep.noPapers": "No papers nominated.",
  "prep.addPaperPlaceholder": "Add paper (title, arXiv id, or URL)",
  "prep.add": "Add",
  "prep.regenerate": "Regenerate",
  "prep.prepare": "Prepare",
  "prep.instructionPlaceholder": "Optional: how to change it",
  "prep.go": "Go",
  "prep.loading": "Loading…",
  "prep.chapterSpines": "Chapter spines",
  "prep.stop": "Stop",
  "prep.resume": "Resume",
  "prep.readingStructure": "Reading this book's structure…",
  "prep.chaptersReady": "{done} of {total} chapters ready",
  "prep.chapterGraph": "Chapter graph",
  "prep.chapterChanged": "A chapter changed; this may be out of date.",
  "prep.connectingChapters": "Connecting the chapters…",
  "prep.chapterGraphFailed": "Chapter graph failed: {error}",
  "prep.noChapters": "No chapters found.",
  "prep.startPapersHint":
    "Nothing prepped for this document yet. The AI will read the papers it leans on and write a note on each.",
  "prep.startChaptersHint":
    "Nothing prepped for this book yet. The AI will read it chapter by chapter and write down what each one does.",
  "prep.startPrep": "Start prep",
  "prep.charsWithUnit": "{value} chars",
  "prep.liveness": "{secs}s · {chars}",
  "prep.retrying": "retrying ({attempt}/{attempts})",

  // The reading-side chat cards: RetellCard and TalkArrangementCard.
  "retell.chapter": "Chapter {n}",
  "retell.inRetell": "In the retell",
  "retell.cut": "Cut",
  "retell.figure": "Figure: {figure}",

  "talk.theTalk": "The talk",
  "talk.spine": "Spine",
  "talk.dropped": "Dropped",
  "talk.moved": "Moved",
  "talk.written": "Written",
  "talk.noThroughLine": "No through-line yet",
  "talk.for": "For",
  "talk.throughout": "Throughout",
  "talk.notGoingInto": "Not going into",
  "talk.untitledSegment": "Untitled segment",
  "talk.segmentsLeft": { one: "{count} segment left.", other: "{count} segments left." },
  "talk.nowSegment": "Now segment {position} of {total}.",
  "talk.blockOf": "Block {position} of {total}",

  // AsideCard: the receipt a side conversation leaves.
  "aside.label": "Aside",

  // reading/intents.ts: the chips a fresh conversation opens with, and what
  // they say as the reader's own words.
  "intent.explain": "Explain this",
  "intent.explainMessage": "Please explain the passage I just marked, using the reading context above.",
  "intent.connect": "How it connects",
  "intent.connectMessage": "How does this passage follow from what came before it?",
  "intent.example": "Give an example",
  "intent.exampleMessage": "Can you give me a concrete example of what this is saying?",
  "intent.doubt": "I have doubts",
  "intent.doubtMessage": "Something here doesn't add up for me. What am I missing?",
  "intent.spanExplainMessage": "Explain the part of your answer I just picked out.",
  "intent.spanExampleMessage": "Can you give me a concrete example of what that means?",
  "intent.spanDoubtMessage": "Something there doesn't add up for me. What am I missing?",
  "intent.bookExtracting": "Still reading through this book — I can't teach from it just yet.",
  "intent.bookUnreadable": "This book's pages have no text layer, so they can't be read as text.",

  // reading/ingest: tool progress labels and errors a chat can print.
  "ingest.fetching": "Fetching {host} …",
  "ingest.extractingText": "Extracting the text …",
  "ingest.filingUnderBook": "Filing it under the book …",
  "ingest.removingSupplement": "Removing a supplement",
  "ingest.removingNamed": "Removing “{title}”",
  "ingest.removedSupplement": "Removed a supplement",
  "ingest.sourceTooLarge": "the source is too large ({mb}MB)",
  "ingest.fetchFailed": "could not fetch the link (HTTP {status})",
  "ingest.unreadable": "could not get readable text from {url}: {reason}",

  // reading/translate: tool progress labels, and the status line the reader
  // watches while a translation runs.
  "translate.label": "Translating this document",
  "translate.labelNamed": "Translating “{title}”",
  "translate.started": "Started a translation",
  "translate.opening": "Translating \"{title}\" — reading the document",
  "translate.segmented": "Translating \"{title}\" — {total} blocks to do",
  "translate.progress": "Translating \"{title}\" — translated {done}/{total} segments",
  "translate.failed": "\"{title}\" could not be translated: {reason}",
  "translate.failedFallback": "The translation failed.",
  "translate.startingFallback": "Starting the translation",
  "translate.gone": "\"{title}\" is no longer on the shelf.",
  "translate.alreadyBilingual": "\"{title}\" is already bilingual.",
  "translate.nothingToTranslate": "\"{title}\" has nothing to translate.",
  "translate.done": "Translated \"{title}\": {blocks} blocks, {marks}.",
  "translate.marksNone": "no marks to move",
  "translate.marksMoved": { one: "{count} mark moved", other: "{count} marks moved" },
  "translate.marksPartial": "{moved}, {unmatched} could not be moved",

  // reading/engine: what the reader is told when a book will not open.
  "engine.openFailedStatus": "Couldn't be opened",
  "engine.openFailedToast": "Couldn't open {which} — the file may be damaged, or not a PDF.",
  "engine.thisBook": "this book",

  // Why the AI pen or the blackboard is dim (reading/turn/call-state.ts), and the
  // aside receipt's summary line (reading/aside.ts).
  "gate.aiPenDim": "Only the book's conversation can open a side one.",
  "gate.bookThreadOpen": "This book's conversation is already open.",
  "gate.bookThreadBehind": "The book's conversation is behind this side one.",
  "aside.receiptSummary": { one: "{count} question while you were reading", other: "{count} questions while you were reading" },
} as const;
