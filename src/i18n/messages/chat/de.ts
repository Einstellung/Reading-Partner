import type { Translation } from "../types";
import type en from "./en";

export default {
  "phase.thinking": "Denkt nach",

  "composer.removeImage": "Bild entfernen",
  "composer.switchToKeyboard": "Zur Tastatur wechseln",
  "composer.switchToVoice": "Zu Sprache wechseln",
  "composer.stop": "Stopp",
  "composer.send": "Senden",

  "dispatch.noRecord": "Auf diesem Gerät liegt dazu nichts vor.",
  "dispatch.backWithAnswer": "Ist mit einer Antwort zurück.",
  "dispatch.stoppedBeforeFinished": "Wurde vor dem Abschluss beendet.",
  "dispatch.stoppedNoReason": "Wurde beendet, ohne einen Grund zu nennen.",
  "dispatch.stillOut": " — noch unterwegs",
  "dispatch.needsDecision": " — braucht deine Entscheidung",
  "dispatch.backSeeBelow": "Zurück — siehe unten",

  "list.copy": "Kopieren",
  "list.copied": "Kopiert",
  "list.attachment": "Anhang",
  "list.toolFailed": "fehlgeschlagen",

  "toolLabel.readingPage": "Liest Seite {page}",
  "toolLabel.readingPages": "Liest Seiten {from}–{to}",
  "toolLabel.readingThePages": "Liest die Seiten",

  "conversations.searchingFor": "Durchsucht frühere Gespräche nach „{query}“",
  "conversations.searching": "Durchsucht frühere Gespräche",
  "conversations.readingBack": "Liest ein früheres Gespräch nach",

  "delegate.handingToKind": "Übergibt dies an eine {kind}-Arbeitskraft",
  "delegate.handingOver": "Übergibt dies an eine Arbeitskraft",
  "delegate.sentOffWork": "{kind}-Auftrag verschickt",

  "places.goingTo": "Geht zu {place}",
  "places.goingSomewhere": "Bewegt sich innerhalb der App",
  "places.wentSomewhere": "Hat sich bewegt",

  "statements.writingSelf": "Notiert, was du über dich selbst gesagt hast",
  "statements.wroteKind": "{kind} notiert",
  "statements.rewroteKind": "{kind} neu geschrieben",

  "filing.proposingUnder": "Schlägt vor, dies unter {topic} einzuordnen",
  "filing.proposingWhere": "Schlägt eine Einordnung vor",
  "filing.proposedWhere": "Einordnung vorgeschlagen",

  "observations.searchingFor": "Durchsucht seine Beobachtungen nach „{query}“",
  "observations.searching": "Durchsucht seine Beobachtungen",
  "observations.reading": "Liest eine Beobachtung",
  "observations.dropping": "Löscht eine Beobachtung",
  "observations.writing": "Notiert eine Beobachtung",
  "observations.updating": "Aktualisiert eine Beobachtung",
  "observations.wroteReceipt": "Beobachtung notiert",
  "observations.addedEvidence": "Beleg zu einer Beobachtung hinzugefügt",
  "observations.droppedReceipt": "Beobachtung gelöscht",
  "observations.updatedReceipt": "Beobachtung aktualisiert",

  "papers.searchingFor": "Durchsucht die Fachliteratur nach „{query}“",
  "papers.searching": "Durchsucht die Fachliteratur",
  "papers.lookingUpFor": "Sucht nach „{paper}“",
  "papers.lookingUp": "Sucht nach einem Fachartikel",
  "papers.walkingCitationsFor": "Verfolgt die Zitate von „{paper}“",
  "papers.walkingCitations": "Verfolgt die Zitate",

  "figures.lookingAtId": "Betrachtet Abbildung {id}",
  "figures.lookingAt": "Betrachtet eine Abbildung",

  "prep.searchingBookFor": "Durchsucht das Buch nach „{query}“",
  "prep.searchingBook": "Durchsucht das Buch",
  "prep.readingNote": "Liest die Notiz zu einem Fachartikel",
  "prep.searchingPaperFor": "Durchsucht den Fachartikel nach „{query}“",
  "prep.searchingPaper": "Durchsucht den Fachartikel",
  "prep.takingInHost": "Übernimmt {host}",
  "prep.takingInPage": "Übernimmt eine Seite",

  "saved.lookingThroughFor": "Durchsucht deine gespeicherten Artikel nach „{query}“",
  "saved.lookingThrough": "Sieht sich deine gespeicherten Artikel an",
  "saved.savingArticle": "Speichert den Artikel",
  "saved.addedToPrepList": "Artikel zur Vorbereitungsliste hinzugefügt",
  "saved.keptArticles": "Gespeicherte Artikel",

  "call.preparing": "Wird vorbereitet…",
  "call.preparingProgress": "Vorbereitung {done}/{total}",
  "call.pageRange": "S. {first}-{last}",
  "call.page": "S. {page}",
  "call.pageBadge": "S. {page}",
  "call.clearFocus": "Kapitelfokus aufheben",
  "call.backToReading": "Zurück zum Lesen",
  "call.deleteConversation": "Unterhaltung löschen",
  "call.deleteTitle": "Diese Unterhaltung löschen?",
  "call.deleteDescription": "Die Unterhaltung wird gelöscht, zusammen mit der Markierung, von der aus sie geöffnet wurde. Das kann nicht rückgängig gemacht werden.",
} satisfies Translation<typeof en>;
