import type { Translation } from "../types";
import type en from "./en";

export default {
  "retell.materialsCount": { one: "{count} Material", other: "{count} Materialien" },
  "retell.noMaterials": "(keine Materialien)",
  "retell.materialsJoin": "und",
  "retell.backToTopic": "Zurück zum Thema",
  "retell.renameTitle": "Diese Nacherzählung umbenennen",
  "retell.renameDescription":
    "Nur der Name ändert sich. Gliederung und Unterhaltung bleiben, wie sie sind.",
  "retell.save": "Sichern",
  "retell.fallbackName": "Nacherzählung",
  "retell.rehearse": "Proben",
  "retell.loading": "Nacherzählung wird geladen…",
  "retell.composerPlaceholder": "Erzähl es mit eigenen Worten…",
  "retell.backToRetell": "Zurück zur Nacherzählung",
  "retell.notReadable": "Diese Nacherzählung konnte nicht gelesen werden.",
  "retell.needProvider":
    "Richte in {settings} einen Anbieter ein, um mit der Nacherzählung zu beginnen.",
  "retell.untitledDefault": "Unbenannte Nacherzählung",
  "retell.namePlusMore": "{title} +{count}",

  "rehearsal.startingTitle": "Diese Probe wird gestartet…",
  "rehearsal.loadingTitle": "Gliederung dieses Vortrags wird gesucht…",
  "rehearsal.emptyTitle":
    "Dieser Vortrag hat noch keinen Inhalt. Zuerst am Ende der Nacherzählung zusammenstellen.",
  "rehearsal.readyTitle": "Den Vortrag von vorn halten",
  "rehearsal.openingNote": "Text wird geöffnet…",
  "rehearsal.outlineMissing": "Die Gliederung dieses Vortrags ist nicht auf diesem Gerät.",
  "rehearsal.outlineReadError": "Gliederung konnte nicht gelesen werden",
  "rehearsal.elapsedTitle": "Wie lange diese Probe schon läuft",
  "rehearsal.starting": "Wird gestartet…",
  "rehearsal.start": "Probe starten",
  "rehearsal.end": "Probe beenden",
  "rehearsal.noSegments":
    "Dieser Vortrag hat noch keinen Inhalt. Zuerst am Ende der Nacherzählung zusammenstellen, dann proben.",

  "coach.fallbackName": "Der Vortrag",
  "coach.subtitle": "Wie diese Probe lief",
  "coach.pendingNotice": "Der letzte Teil des Gesagten kommt gerade vom Erkenner zurück…",
  "coach.loading": "Vortrag wird geöffnet…",
  "coach.composerPlaceholder": "Frag, wie die Probe lief, oder sag, was sich ändern soll…",
  "coach.needProvider":
    "Richte in {settings} einen Anbieter ein, dann kann ich dir sagen, wie diese Probe lief.",

  "talk.untitledDefault": "Unbenannter Vortrag",
  "talk.untitledSegment": "Unbenannter Block",

  "tools.setSpine": "Roter Faden des Vortrags wird festgelegt",
  "tools.setSpineDone": "Roter Faden des Vortrags festgelegt",
  "tools.writeSegment": "Ein Block des Vortrags wird geschrieben",
  "tools.rewroteSegment": "Ein Block des Vortrags wurde neu geschrieben",
  "tools.addedSegment": "Ein Block wurde zum Vortrag hinzugefügt",
  "tools.moveSegment": "Ein Block des Vortrags wird verschoben",
  "tools.movedSegment": "Ein Block des Vortrags wurde verschoben",
  "tools.removeSegment": "Ein Block des Vortrags wird entfernt",
  "tools.droppedSegment": "Ein Block des Vortrags wurde entfernt",
  "tools.readTalkOutline": "Gliederung des Vortrags wird gelesen",
  "tools.settlingChapter": "Ein Kapitel wird festgelegt",
  "tools.settlingChapterNum": "Kapitel {chapter} wird festgelegt",
  "tools.keptChapter": "Ein Kapitel wurde übernommen",
  "tools.cutChapter": "Ein Kapitel wurde gestrichen",
  "tools.readingChapterNote": "Notiz zu einem Kapitel wird gelesen",
  "tools.readingChapterNoteNum": "Notiz zu Kapitel {chapter} wird gelesen",
  "tools.readRetellOutline": "Gliederung der Nacherzählung wird gelesen",

  "budget.prepNotesTrimmed":
    "ein Teil meiner Notizen zu den Referenzartikeln wurde weggelassen, um Platz zu schaffen",
  "budget.marksTrimmed":
    "deine Markierungen sind hier gekürzt, damit sie passen; sag mir, wenn ich die eines Kapitels vollständig holen soll, dann lese ich sie erneut",
  "budget.historyTrimmedRetell": "der Anfang dieser Unterhaltung wurde weggelassen, um Platz zu schaffen",
  "budget.passesTrimmed": "frühere Proben dieses Vortrags wurden weggelassen, um Platz zu schaffen",

  "rows.retellNotYet": "Aus einer Nacherzählung · noch nicht geprobt",
  "rows.retellCount": {
    one: "Aus einer Nacherzählung · {count} Probe",
    other: "Aus einer Nacherzählung · {count} Proben",
  },
  "rows.broughtInNotYet": "Einzeln angelegt · noch nicht geprobt",
  "rows.broughtInCount": {
    one: "Einzeln angelegt · {count} Probe",
    other: "Einzeln angelegt · {count} Proben",
  },
} satisfies Translation<typeof en>;
