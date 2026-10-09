// Chat: the message list and composer (ui/components/chat, minus voice/ and
// call/), plus the tool-call progress labels and receipts the capabilities
// behind a turn report — conversations, memory, soul, and the reading-side
// research/prep/saved tools. The source every other locale is typed against.

export default {
  "phase.thinking": "Thinking",

  "composer.removeImage": "Remove image",
  "composer.switchToKeyboard": "Switch to keyboard",
  "composer.switchToVoice": "Switch to voice",
  "composer.stop": "Stop",
  "composer.send": "Send",
  "call.reply": "Reply…",

  "dispatch.noRecord": "No record of it on this device.",
  "dispatch.backWithAnswer": "Back with an answer.",
  "dispatch.stoppedBeforeFinished": "Stopped before it finished.",
  "dispatch.stoppedNoReason": "It stopped without saying why.",
  "dispatch.stillOut": " — still out",
  "dispatch.needsDecision": " — needs your decision",
  "dispatch.backSeeBelow": "Back — see below",

  "list.copy": "Copy",
  "list.copied": "Copied",
  "list.attachment": "attachment",
  "list.toolFailed": "failed",

  "toolLabel.readingPage": "Reading page {page}",
  "toolLabel.readingPages": "Reading pages {from}–{to}",
  "toolLabel.readingThePages": "Reading the pages",

  "conversations.searchingFor": "Searching past conversations for “{query}”",
  "conversations.searching": "Searching past conversations",
  "conversations.readingBack": "Reading back a conversation",

  "delegate.handingToKind": "Handing this to a {kind} worker",
  "delegate.handingOver": "Handing this over to a worker",
  "delegate.sentOffWork": "Sent off {kind} work",

  "places.goingTo": "Going to {place}",
  "places.goingSomewhere": "Going somewhere in the app",
  "places.wentSomewhere": "Went somewhere",

  "statements.writingSelf": "Writing down what you said about yourself",
  "statements.wroteKind": "Wrote down a {kind}",
  "statements.rewroteKind": "Rewrote a {kind}",

  "filing.proposingUnder": "Proposing this belongs under {topic}",
  "filing.proposingWhere": "Proposing where this belongs",
  "filing.proposedWhere": "Proposed where this belongs",

  "observations.searchingFor": "Searching its observations for “{query}”",
  "observations.searching": "Searching its observations",
  "observations.reading": "Reading an observation",
  "observations.dropping": "Dropping an observation",
  "observations.writing": "Writing down an observation",
  "observations.updating": "Updating an observation",
  "observations.wroteReceipt": "Wrote down an observation",
  "observations.addedEvidence": "Added evidence to an observation",
  "observations.droppedReceipt": "Dropped an observation",
  "observations.updatedReceipt": "Updated an observation",

  "papers.searchingFor": "Searching the literature for “{query}”",
  "papers.searching": "Searching the literature",
  "papers.lookingUpFor": "Looking up “{paper}”",
  "papers.lookingUp": "Looking up a paper",
  "papers.walkingCitationsFor": "Walking the citations of “{paper}”",
  "papers.walkingCitations": "Walking the citations",

  "figures.lookingAtId": "Looking at figure {id}",
  "figures.lookingAt": "Looking at a figure",

  "prep.searchingBookFor": "Searching the book for “{query}”",
  "prep.searchingBook": "Searching the book",
  "prep.readingNote": "Reading the note on a paper",
  "prep.searchingPaperFor": "Searching the paper for “{query}”",
  "prep.searchingPaper": "Searching the paper",
  "prep.takingInHost": "Taking in {host}",
  "prep.takingInPage": "Taking in a page",

  "saved.lookingThroughFor": "Looking through what you saved for “{query}”",
  "saved.lookingThrough": "Looking through what you saved",
  "saved.savingArticle": "Saving the article",
  "saved.addedToPrepList": "Added an article to the prep list",
  "saved.keptArticles": "Kept articles",

  // The chrome around a call (chat/call/): the focus line, the corner card
  // that goes back to the page, and the delete control.
  "call.preparing": "Preparing…",
  "call.preparingProgress": "Preparing {done}/{total}",
  "call.pageRange": "p.{first}-{last}",
  "call.page": "p.{page}",
  "call.pageBadge": "p. {page}",
  "call.clearFocus": "Clear chapter focus",
  "call.backToReading": "Back to reading",
  "call.deleteConversation": "Delete conversation",
  "call.deleteTitle": "Delete this conversation?",
  "call.deleteDescription": "The conversation goes, and with it the mark it was opened from. This cannot be undone.",
} as const;
