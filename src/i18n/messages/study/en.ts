// Study: giving a book back (docs/31, docs/44) — the retell's own screen and
// header, the talk it arranges, a rehearsal pass and the coach that follows one.
// The source every other locale is typed against.

export default {
  "retell.materialsCount": { one: "{count} material", other: "{count} materials" },
  "retell.noMaterials": "(no materials)",
  "retell.materialsJoin": "and",
  "retell.backToTopic": "Back to the topic",
  "retell.renameTitle": "Rename this retell",
  "retell.renameDescription":
    "Only the name changes. The outline and the conversation stay as they are.",
  "retell.save": "Save",
  "retell.fallbackName": "Retell",
  "retell.rehearse": "Rehearse",
  "retell.loading": "Loading the retell…",
  "retell.composerPlaceholder": "Say it in your own words…",
  "retell.backToRetell": "Back to the retell",
  "retell.notReadable": "This retell could not be read.",
  "retell.needProvider": "Configure a provider in {settings} to start the retell.",
  "retell.untitledDefault": "Untitled retell",
  "retell.namePlusMore": "{title} +{count}",

  "rehearsal.startingTitle": "Starting this rehearsal…",
  "rehearsal.loadingTitle": "Looking for this talk's outline…",
  "rehearsal.emptyTitle": "This talk has no segments yet. Arrange it at the end of the retell first.",
  "rehearsal.readyTitle": "Give the talk, from the top",
  "rehearsal.openingNote": "Opening the note…",
  "rehearsal.outlineMissing": "The outline for this talk is not on this device.",
  "rehearsal.outlineReadError": "Could not read the outline",
  "rehearsal.elapsedTitle": "How long this rehearsal has been going",
  "rehearsal.starting": "Starting…",
  "rehearsal.start": "Start the rehearsal",
  "rehearsal.end": "End the rehearsal",
  "rehearsal.noSegments":
    "This talk has no segments yet. Arrange it at the end of the retell, then rehearse.",

  "coach.fallbackName": "The talk",
  "coach.subtitle": "How that pass went",
  "coach.pendingNotice": "Getting the last of what you said back from the recogniser…",
  "coach.loading": "Opening the talk…",
  "coach.composerPlaceholder": "Ask about the pass, or say what to change…",
  "coach.needProvider": "Configure a provider in {settings} and I can tell you how that pass went.",

  "talk.untitledDefault": "Untitled talk",
  "talk.untitledSegment": "Untitled segment",

  "tools.setSpine": "Setting the spine of the talk",
  "tools.setSpineDone": "Set the spine of the talk",
  "tools.writeSegment": "Writing a block of the talk",
  "tools.rewroteSegment": "Rewrote a block of the talk",
  "tools.addedSegment": "Added a block to the talk",
  "tools.moveSegment": "Moving a block of the talk",
  "tools.movedSegment": "Moved a block of the talk",
  "tools.removeSegment": "Dropping a block of the talk",
  "tools.droppedSegment": "Dropped a block of the talk",
  "tools.readTalkOutline": "Reading the talk outline",
  "tools.settlingChapter": "Settling a chapter",
  "tools.settlingChapterNum": "Settling chapter {chapter}",
  "tools.keptChapter": "Kept a chapter",
  "tools.cutChapter": "Cut a chapter",
  "tools.readingChapterNote": "Reading a chapter note",
  "tools.readingChapterNoteNum": "Reading the note on chapter {chapter}",
  "tools.readRetellOutline": "Reading the retell outline",

  "budget.prepNotesTrimmed": "some of my notes on the reference papers were left out to make room",
  "budget.marksTrimmed":
    "your highlights are shortened here to fit; ask me to pull a chapter's marks up in full and I'll read them again",
  "budget.historyTrimmedRetell": "earlier turns of this conversation were left out to make room",
  "budget.passesTrimmed": "earlier passes over this talk were left out to make room",

  "rows.retellNotYet": "From a retell · not rehearsed yet",
  "rows.retellCount": {
    one: "From a retell · {count} rehearsal",
    other: "From a retell · {count} rehearsals",
  },
  "rows.broughtInNotYet": "Brought in · not rehearsed yet",
  "rows.broughtInCount": {
    one: "Brought in · {count} rehearsal",
    other: "Brought in · {count} rehearsals",
  },
} as const;
