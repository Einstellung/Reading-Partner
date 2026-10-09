// Library: the topic shelf, a topic's four sections (Materials, Retell,
// Rehearsal, AI observations), and the shared card/shelf chrome under
// ui/components/shelf. The source every other locale is typed against.

export default {
  // Shared counts, reused across the area wherever the same noun is counted.
  "count.books": { one: "{count} book", other: "{count} books" },
  "count.articles": { one: "{count} article", other: "{count} articles" },
  "count.topics": { one: "{count} topic", other: "{count} topics" },
  "count.files": { one: "{count} file", other: "{count} files" },
  "count.marks": { one: "{count} mark", other: "{count} marks" },
  "count.observations": { one: "{count} observation", other: "{count} observations" },
  "count.messages": { one: "{count} message", other: "{count} messages" },
  "count.conflictCopies": { one: "{count} conflict copy", other: "{count} conflict copies" },
  // Two already-localized counts joined: "2 books and 1 article".
  "count.booksAndArticles": "{books} and {articles}",

  // Relative time, shared by a topic's header line.
  "time.today": "today",
  "time.yesterday": "yesterday",
  "time.daysAgo": { one: "{count} day ago", other: "{count} days ago" },
  "time.weeksAgo": { one: "{count} week ago", other: "{count} weeks ago" },
  "time.monthsAgo": { one: "{count} month ago", other: "{count} months ago" },
  "time.yearsAgo": { one: "{count} year ago", other: "{count} years ago" },

  "header.lastRead": "last read {when}",

  // A book's card (file-title.ts readingLabel).
  "shelf.readPercent": "Read {percent}%",
  "shelf.page": "Page {page}",
  "shelf.notOpened": "Not opened yet",
  "shelf.noFiles": "No files",

  // One shared confirmation shape, reused by the topic, retell and rehearsal
  // delete dialogs, which all ask "Delete “X”?" and report the same failure.
  "deleteTitle": "Delete “{name}”?",
  "deleteFailed": "Could not delete “{name}”",

  // A library card's menu (BookCard, TopicCard) and its shared actions.
  "card.actionsFor": "Actions for {name}",
  "card.remove": "Remove",
  "card.rename": "Rename",
  "card.delete": "Delete",
  "card.retell": "Retell this book…",
  // move-to.ts, MoveToTopicDialog.tsx: a file onto another topic, phone and desk.
  "move.action": "Move to…",
  "move.title": "Move to",
  "move.here": "Here",
  "move.done": "Moved to “{topic}”",
  "move.failed": "It could not be moved.",

  // The topic shelf (LibraryScreen's TopicLibrary).
  "topics.eyebrow": "Your topics",
  "topics.title": "Topics",
  "topics.blurb": "A topic is one question and the books you read against it.",
  "topics.newTopicButton": "+ New topic",
  "topics.emptyTitle": "Nothing on the shelf yet",
  "topics.emptyBlurb":
    "A topic is one question and the books you read against it. Name the question first; the PDFs go in after.",
  "topics.emptyAction": "New topic",
  "topics.createTitle": "New topic",
  "topics.createConfirm": "Create",
  "topics.placeholder": "e.g. what makes JITs fast",
  "topics.renameTitle": "Rename topic",
  "topics.renameDescription": "Only the name changes. The reading list stays as it is.",
  "topics.renameConfirm": "Save",

  // A topic's Materials section (LibraryScreen's TopicMaterials).
  "materials.emptyTitle": "No books in this topic yet",
  "materials.emptyBlurb":
    "Add the books you want to read against this question. They are read where they are; nothing is copied or moved.",
  "materials.addBook": "Add book",
  "materials.savedArticlesHeading": "Saved articles",
  "materials.removeArticleTitle": "Remove “{title}”?",
  "materials.removeArticleDescription":
    "The article leaves your saved articles. Saving it again from a briefing brings it back.",
  "materials.removeArticleAction": "Remove",
  "materials.deleteBookTitle": "Delete “{title}”?",
  "materials.deleteBookDescription":
    "Delete this book and everything about it? Your notes about yourself stay.",
  "materials.deleteBookAction": "Delete",

  // The topic screen's own chrome (LibraryScreen).
  "screen.backToTopics": "‹ All topics",
  "screen.addBook": "+ Add book",
  "screen.backToTopicLabel": "Back to the topic",
  "screen.deleteBookFailed": "Could not delete the book",
  "screen.removeArticleFailed": "Could not remove the article",

  // A topic's delete confirmation (shelf/topic-delete.ts).
  "topicDelete.onlyCaption": "Only in this topic",
  "topicDelete.description":
    "The topic goes, on every device, with the retells, talks and rehearsals made in it.",
  "topicDelete.articlesMoveNote": "Articles saved here move to Brief.",
  "topicDelete.sharedOneBook": "One book is also filed under another topic and stays there.",
  "topicDelete.sharedOneArticle": "One article is also filed under another topic and stays there.",
  "topicDelete.sharedMany": "{tally} are also filed under other topics and stay there.",
  "topicDelete.checkOneBook": "Also delete this book",
  "topicDelete.checkOneArticle": "Also delete this article",
  "topicDelete.checkMany": "Also delete these {tally}",
  "topicDelete.action": "Delete",
  "topicDelete.actionOneBook": "Delete topic and book",
  "topicDelete.actionOneArticle": "Delete topic and article",
  "topicDelete.actionAll": { one: "Delete topic and all {count}", other: "Delete topic and all {count}" },
  "topicDelete.doneNone": "Deleted “{name}”",
  "topicDelete.doneOne": "Deleted “{name}” and {tally}",
  "topicDelete.doneMany": "Deleted “{name}”, {tally}",
  "topicDelete.kindArticle": "Article",

  // The Rehearsal section (topic/RehearsalSection.tsx).
  "rehearsal.goneError": "That rehearsal is no longer there",
  "rehearsal.noTalkError": "That talk has nothing to rehearse against",
  "rehearsal.openFailed": "Could not open the rehearsal",
  "rehearsal.emptyBlurb":
    "Nothing to rehearse here yet. A talk shows up here once a retell has arranged one, and every pass over it is kept, so the next one has something to be held against.",
  "rehearsal.howItWent": "How it went",
  "rehearsal.rehearseButton": "Rehearse",
  "rehearsal.deleteMenuItem": "Delete this rehearsal",
  "rehearsal.deleteDescription":
    "Every pass over this talk goes with it. The talk itself stays where it is, and you can rehearse it again from the retell.",

  // The Retell section (topic/RetellSection.tsx, topic/NewRetellDialog.tsx).
  "retell.startFailed": "Could not start the retell",
  "retell.emptyBlurb":
    "No retells yet. A retell is one thing you are preparing to give from what you have read here — you go through it chapter by chapter with the AI, and the outline of the retell is what comes out.",
  "retell.newRetellButton": "New retell",
  "retell.deleteMenuItem": "Delete this retell",
  "retell.deleteDescription":
    "The retell goes, and with it the outline you settled and every rehearsal of its talk. The books, their marks and their notes are untouched.",
  "retell.pickDescription":
    "A retell is prepared by going through what you read, chapter by chapter, and settling what it contributes. Pick what it is about.",
  "retell.noCandidates": "Nothing to retell yet — open a book in this topic first.",
  "retell.cancel": "Cancel",
  "retell.start": "Start",

  "loading": "Loading…",

  // AI observations (topic/ObservationPanel.tsx).
  "observations.heading": "AI observations",
  "observations.lastDistilled": "Last distilled {date}",
  "observations.noDistillation": "No distillation has run yet.",
  "observations.empty": "Nothing observed yet. Observations are distilled when a conversation ends.",
  "observations.footer": "Observations are maintained by the AI. If one is off, say so in a conversation.",
  "observations.aboutYou": "About you",
  "observations.lastSupported": "last supported {date}",
  "observations.fromEvidence": "from {evidence}",
  "observations.updated": "updated {date}",
  "observations.evidenceLabel": "Evidence:",
  "observations.evidenceAnnotation": "annotation {id}",
  "observations.evidenceMessage": "message {id}",
  "observations.conflictNotice":
    "{copies} from sync. Two devices changed the same observation; the version that lost is kept beside it.",
  "observations.conflictUnreadable": "(this copy could not be read; open the file to see it)",
  // The statement's own kind. Kept lowercase, matching the small badge it has
  // always been — see statement.kindProfile/kindConcern for the same words.
  "observations.typeReadingPosition": "reading position",
  "observations.typeStuckPoint": "stuck point",
  "observations.typeCannotExplain": "cannot explain",
  "observations.typeCanExplain": "can explain",
  "observations.typeUnderstoodConcept": "understood concept",
  "observations.typeBelief": "belief",
  "observations.typeCorrection": "correction",

  // What is held to be true about the reader (topic/statements-view.ts).
  "statement.youSaid": "You said",
  "statement.concluded": "Concluded",
  // Two already-localized evidence counts joined: "1 observation, 2 messages".
  "statement.evidenceBoth": "{observations}, {messages}",
  "statement.kindProfile": "profile",
  "statement.kindConcern": "concern",

  // A topic's four sections, as tabs (topic/TopicNav.tsx, base/topic-nav.ts).
  "section.navLabel": "Topic",
  "section.materials": "Materials",
  "section.retell": "Retell",
  "section.rehearsal": "Rehearsal",
  "section.observations": "AI observations",

  // A saved article, read on its own (SavedArticleView.tsx).
  "savedArticle.backDefault": "Topic",
  "savedArticle.summaryOnlyNote":
    "The full text of this article was never retrieved. What follows is only a summary.",
  "savedArticle.noBody": "No body was saved with this article.",
} as const;
