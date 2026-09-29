// Phone: the phone shell's shelf, reader and lesson (docs/70, docs/74, docs/77)
// — everything under ui/components/phone, plus the two lesson-opening lines in
// reading/lesson (status.ts, opening.ts) that only this shell sends. Voice
// (dictation, hold-to-talk) is out of scope until north-star/voice-i18n.
// The source every other locale is typed against.

export default {
  // ---- hold-menu.ts: the menu a hold opens, its confirmation, and the line
  // said after (docs/50). Shared by every phone list that can be held: topics,
  // files, saved articles, asides.
  "holdMenu.deleteTopic": "Delete topic",
  "holdMenu.deleteLesson": "Delete lesson",
  "holdMenu.deleteConversation": "Delete conversation",
  "holdMenu.removeFromTopic": "Remove from topic",
  "holdMenu.deleteArticle": "Delete article",
  "holdMenu.deleteBook": "Delete book",
  "holdMenu.removeFromSaved": "Remove from Saved",
  "holdMenu.deleteAside": "Delete aside",

  "holdMenu.confirmDeleteFileTitle": "Delete “{title}”?",
  "holdMenu.confirmDeleteBookDescription":
    "Delete this book and everything about it, on every device? Your notes about yourself stay.",
  "holdMenu.confirmDeleteArticleDescription":
    "Delete this article and everything about it, on every device? Your notes about yourself stay.",
  "holdMenu.delete": "Delete",
  "holdMenu.confirmRemoveTitle": "Remove “{title}”?",
  "holdMenu.removeOthers": "It stays in {names}",
  "holdMenu.removeNoOthers": "Something else still lists it, so it stays",
  "holdMenu.removeBookDescription": "This topic loses the book. {where}, with its reading position and marks.",
  "holdMenu.removeArticleDescription":
    "This topic loses the article. {where}, with its reading position and marks.",
  "holdMenu.remove": "Remove",
  "holdMenu.confirmConversationTitle": "Delete this conversation?",
  "holdMenu.confirmLessonDescription":
    "The lesson goes, with its asides, on every device. The paper stays, and the next lesson starts from the beginning.",
  "holdMenu.confirmConversationDescription":
    "Everything said about this book goes, on every device. The book, its marks and its reading position stay.",
  "holdMenu.confirmRemoveSavedDescription": "It leaves Saved on every device. The briefing it came from is not changed.",
  "holdMenu.confirmDeleteAsideDescription": "The aside goes, and its row in the lesson with it. The lesson itself stays.",

  "holdMenu.doneDeleted": "Deleted “{title}”",
  "holdMenu.doneRemovedFromTopic": "Removed from {topicName}",
  "holdMenu.doneLessonDeleted": "Lesson deleted",
  "holdMenu.doneConversationDeleted": "Conversation deleted",
  "holdMenu.doneRemovedFromSaved": "Removed from Saved",
  "holdMenu.doneAsideDeleted": "Aside deleted",

  // hold-delete.ts: the line said when a confirmed choice failed to go through.
  "holdMenu.failedTopic": "The topic could not be deleted.",
  "holdMenu.failedFile": "It could not be deleted.",
  "holdMenu.failedRemoveFromTopic": "It could not be removed from this topic.",
  "holdMenu.failedConversation": "The conversation could not be deleted.",
  "holdMenu.failedRemoveSaved": "It could not be removed from Saved.",

  // ---- SavedList.tsx: the kept articles list.
  "savedList.back": "Today",
  "savedList.count": { one: "{count} saved article", other: "{count} saved articles" },
  "savedList.empty": "Nothing kept yet.",
  "savedList.summaryOnly": "summary only",

  // ---- PhoneHome.tsx: the home screen's four cards.
  "home.today": "Today",
  "home.briefingLabel": "Today's briefing",
  "home.mealsLabel": "Meals",
  "home.mealsBlurb": "This week's breakfasts, lunches and dinners, and what to buy.",
  "home.open": "Open →",
  "home.savedLabel": "Saved",
  "home.savedBlurb": "Articles you kept, to read whenever.",
  "home.savedCount": { one: "{count} article", other: "{count} articles" },
  "home.savedEmpty": "Nothing kept yet. Keep an article from the briefing and it waits here.",
  "home.libraryLabel": "Library",
  "home.continueReading": "Continue reading · {topicName}",
  "home.libraryBlurb": "Your topics and the books filed under them.",
  "home.allTopics": "All topics",

  // ---- NewTopicSheet.tsx: naming a new topic.
  "newTopic.title": "New topic",
  "newTopic.fieldLabel": "Topic name",
  "newTopic.cancel": "Cancel",
  "newTopic.create": "Create",

  // ---- PhoneShelf.tsx: the topic list and one topic's files.
  "shelf.libraryLabel": "Library",
  "shelf.backHome": "Home",
  "shelf.topicCount": { one: "{count} topic", other: "{count} topics" },
  "shelf.newTopic": "New topic",
  "shelf.noTopicsYet": "No topics yet.",
  "shelf.created": "Created “{name}”",
  "shelf.createFailed": "The topic could not be created.",
  "shelf.importing": "Importing…",
  "shelf.importEpub": "Import EPUB",
  "shelf.nothingFiled": "Nothing filed here yet.",
  "shelf.lessonBadge": "Lesson",
  "shelf.downloadFailed": "This book could not be downloaded",
  "shelf.importFailed": "This book could not be imported",

  // ---- shelf-list.ts: what a card says about where its bytes are.
  "shelfList.notConfigured": "This build has no Google account set up, so it cannot download the book",
  "shelfList.signInToDownload": "Sign in to your account in Settings to download this book",
  "shelfList.notImported": "The desk has not imported this file yet, so there is nothing to get",
  "shelfList.notFiledYet": "This book has not finished syncing to this device yet",
  "shelfList.downloading": "Downloading…",
  "shelfList.notImportedShort": "Not imported",
  "shelfList.inCloud": "In the cloud",
  "shelfList.notSyncedYet": "Not synced yet",
  "shelfList.lessonNotStarted": "Not started",
  "shelfList.lessonOn": "On {title}",
  "shelfList.lessonInProgress": "In a lesson",

  // ---- reader/PhoneReader.tsx: the reading screen.
  "reader.rendering": "Rendering…",
  "reader.openFailed": "This book could not be opened.",
  "reader.drawFailed": "This book could not be drawn.",
  "reader.deleteMarkTitle": "Delete this mark?",
  "reader.deleteMarkDescription":
    "The mark goes, and with it the conversation opened from it. This cannot be undone.",
  "reader.deleteMarkButton": "Delete this mark",
  "reader.delete": "Delete",

  "reader.hintTap": "Tap the middle for tools",
  "reader.hintHold": "Hold a word to select",

  // ---- reader/PhoneReaderBar.tsx: the reading screen's two bars.
  "readerBar.backToShelf": "Back to the shelf",
  "readerBar.tools": "Reading tools",
  "readerBar.outline": "Outline",
  "readerBar.display": "Display",
  "readerBar.learn": "Learn",
  "readerBar.learnThisBook": "Learn this book with AI",
  "readerBar.dotWriting": " (a reply is being written)",
  "readerBar.dotUnseen": " (new reply)",

  // ---- reader/PhoneSelection.tsx: what a selection offers.
  "selection.label": "Selection",
  "selection.highlight": "Highlight",
  "selection.ask": "Ask",

  // ---- reader/PhoneMarkPopup.tsx: what a tapped mark offers.
  "markPopup.highlight": "Highlight",
  "markPopup.conversation": "Conversation",
  "markPopup.open": "Open",
  "markPopup.ask": "Ask",
  "markPopup.delete": "Delete",
  "markPopup.deleteUnderline": "Delete underline",
  "markPopup.deleteHighlight": "Delete highlight",

  // ---- reader/PhoneDisplaySheet.tsx: the Aa sheet.
  "displaySheet.title": "Display",
  "displaySheet.size": "Size",
  "displaySheet.smallerText": "Smaller text",
  "displaySheet.largerText": "Larger text",
  "displaySheet.lineSpacing": "Line spacing",
  "displaySheet.margins": "Margins",
  "displaySheet.scroll": "Scroll",
  "displaySheet.pages": "Pages",
  "displaySheet.paper": "Paper",
  "displaySheet.lumen": "Lumen",

  // ---- reader/PhoneContentsSheet.tsx: Outline, Marks and Prep.
  "contents.label": "Outline, marks and prep",
  "contents.outline": "Outline",
  "contents.marks": "Marks",
  "contents.prep": "Prep",
  "contents.done": "Done",

  // ---- reader/PhoneMarksList.tsx: every mark in the book.
  "marks.emptyTitle": "No marks yet",
  "marks.emptyBody": "Hold a word to select it, then choose Highlight or Ask.",
  "marks.highlightRow": "Highlight: {text}",
  "marks.underlineRow": "Underline: {text}",
  "marks.page": "p. {label}",
  "marks.openConversation": "Open conversation",
  "marks.delete": "Delete",

  // ---- reader/PhonePrepTab.tsx: what the AI prepared about the book.
  "prep.title": "Chapter spines",
  "prep.ready": "{done} of {total} chapters ready",
  "prep.graph": "Chapter graph",
  "prep.loading": "Reading…",
  "prep.empty":
    "Nothing has been prepared for this book yet. Prep runs on the iPad or the desktop and shows up here once it syncs.",
  "prep.notReady": "Not prepared yet.",

  // ---- lesson/PhoneLessonBar.tsx: the lesson screen's top bar.
  "lessonBar.backToShelf": "Back to the shelf",
  "lessonBar.chapters": "Chapters",
  "lessonBar.openIn": "Open in…",

  // ---- lesson/PhoneLessonIntroSheet.tsx: said once, the first PDF tap.
  "lessonIntro.title": "This one opens as a lesson",
  "lessonIntro.body1":
    "On the phone a PDF is not turned page by page. It opens as a lesson: I take you through the paper in text, quoting it with page numbers as we go.",
  "lessonIntro.body2":
    "To see the pages themselves — the figures, the tables, the typesetting — hand the file to another app with Open in…, or read it on the iPad.",
  "lessonIntro.body3": "Said once. Next time this card goes straight into the lesson.",
  "lessonIntro.start": "Start the lesson",
  "lessonIntro.openIn": "Open in…",

  // ---- lesson/PhoneChapterSheet.tsx: the lesson's chapter list.
  "chapterSheet.title": "Chapters",
  "chapterSheet.empty": "This paper has no chapter list on this device yet.",
  "chapterSheet.now": "Now",

  // ---- lesson/lesson-view.ts: the two standing chips, and the focus line.
  "lessonView.chipDontFollowLabel": "I don't follow",
  "lessonView.chipDontFollowText": "I don't follow.",
  "lessonView.chipSkipLabel": "Skip",
  "lessonView.chipSkipText": "Skip this one.",
  "lessonView.continuingFrom": "Continuing from: {title}",
  "lessonView.now": "Now: {title}",
  "lessonView.nowWithPage": "Now: {title} · p.{page}",

  // ---- lesson/PhoneBookLesson.tsx: the lesson on the EPUB reader.
  "bookLesson.backToPage": "Back to the page",
  "bookLesson.title": "Learn",
  "bookLesson.done": "Done",
  "bookLesson.passagePlaceholder": "Ask about this passage",
  "bookLesson.retry": "Retry",
  "bookLesson.ariaLabel": "Lesson",
  "bookLesson.placeholder": "Ask me to teach you part of this book…",

  // ---- lesson/PhoneLesson.tsx: the PDF lesson screen and its aside.
  "lesson.backToLesson": "Back to the lesson",
  "lesson.aside": "Aside",
  "lesson.placeholder": "Ask about the paper…",
  "lesson.askAboutThis": "Ask about this",

  // ---- lesson/use-lesson-call.ts: the lesson's own status lines.
  "lessonCall.noProvider": "Configure a provider in Settings and this paper can be taught.",
  "lessonCall.noThread": "This paper's conversation could not be read on this device.",
  "lessonCall.openFailed": "This paper could not be opened.",

  // ---- lesson/use-book-lesson.ts: the EPUB lesson's session.
  "bookLessonHook.imageLimitHint": {
    one: "You can attach up to {count} image.",
    other: "You can attach up to {count} images.",
  },
  "bookLessonHook.threadsUnreadable": "Saved AI conversations could not be loaded",

  // ---- gesture/PullToAsk.tsx: the pull-down-to-ask affordance.
  "pullToAsk.releaseToAsk": "Release to ask",

  // ---- reading/lesson/status.ts: opening a PDF lesson's paper.
  "lessonStatus.downloading": "Downloading…",
  "lessonStatus.reading": "Reading the paper…",
  "lessonStatus.failedDownload": "This paper could not be downloaded.",
  "lessonStatus.failedUnreadable": "This PDF could not be read.",
  "lessonStatus.failedNoText": "This PDF is a scan with no text in it, so there is no lesson to give.",

  // ---- reading/lesson/opening.ts: the reader's own words, written for them.
  "lessonOpening.text":
    "Give me the skeleton of this paper first — how many parts it has and what each one does, in one screen. I'm reading on my phone and the pages aren't in front of me, so for a figure or a table just name it and give me its page; you can tell me what the caption says. Then don't ask me, take me straight to the first stop.",
  "lessonOpening.takeMeToChapterTitle": "Take me to {title}.",
  "lessonOpening.takeMeToPage": "Take me to page {page}.",
  "lessonOpening.takeMeToChapterNumber": "Take me to chapter {number}.",

  // The Aa sheet's choices (reading/epub/flow/flow-display.ts).
  "displaySheet.lineTight": "Tight",
  "displaySheet.lineStandard": "Standard",
  "displaySheet.lineLoose": "Loose",
  "displaySheet.marginsNarrow": "Narrow",
  "displaySheet.marginsWide": "Wide",
  "displaySheet.paperWhite": "White",
  "displaySheet.paperPaper": "Paper",
  "displaySheet.paperGreen": "Green",
  "displaySheet.paperDark": "Dark",
} as const;
