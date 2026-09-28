import type { Translation } from "../types";
import type en from "./en";

export default {
  "toast.cantOpenDownloading": "Kann nicht geöffnet werden — der Download ist vielleicht noch nicht fertig.",
  "toast.cantOpenFile": "Diese Datei kann nicht geöffnet werden — sie wurde vielleicht verschoben oder gelöscht.",
  "toast.cantReadFile": "Diese Datei kann nicht gelesen werden — sie wurde vielleicht verschoben oder gelöscht.",
  "toast.asideGone": "Dieses Seitengespräch gibt es nicht mehr.",
  "toast.conversationsUnloadable": "Gespeicherte KI-Unterhaltungen konnten nicht geladen werden",
  "toast.cantShareFile": "Diese Datei konnte nicht an eine andere App übergeben werden.",

  "call.askAboutThisTitle": "Dazu fragen",
  "call.askAboutThisPlaceholder": "Dazu fragen…",
  "call.teachPlaceholder": "Lass dir einen Teil dieses Buchs erklären…",
  "call.thisBookFallback": "Dieses Buch",
  "call.configurePrompt": "Verbinde in den Einstellungen einen Anbieter, um zu chatten.",
  "call.openSettings": "Einstellungen öffnen",
  "call.retry": "Erneut versuchen",

  "action.dismiss": "Verwerfen",
  "action.cancel": "Abbrechen",
  "action.delete": "Löschen",

  "savedArticle.backLabel": "Gespeichert",

  "nav.settings": "Einstellungen",
  "nav.settingsNeedsAttention": "Einstellungen — Synchronisierung braucht Aufmerksamkeit",
  "sidebar.sections": "Bereiche",
  "sidebar.expand": "Seitenleiste einblenden",
  "sidebar.collapse": "Seitenleiste einklappen",
  "sidebar.updating": "Wird aktualisiert…",
  "sidebar.restartToUpdate": "Für Update neu starten",

  "lumen.show": "Lumen einblenden",
  "lumen.hide": "Lumen ausblenden",
  "lumen.needsDecision": "Entscheidung nötig",

  "box.bookFallback": "Ein Buch",
  "box.originBookPage": "{book} · S. {page}",
  "box.originDoor": "An der Tür · {date}",
  "box.originBriefing": "Briefing · {date}",
  "box.originMeals": "Mahlzeiten",
  "box.label": "Die Box",
  "box.waiting": { one: "Die Box, {count} wartend", other: "Die Box, {count} wartend" },
  "box.empty": "Nichts in der Box.",
  "box.notReadable": "Das steckt in einem Buch. Öffne es auf dem iPad oder am Schreibtisch.",

  "figure.label": "Abb. {id} · S.{page}",
  "figure.number": "Abb. {id}",
  "figure.pageSuffix": "· S.{page}",
  "figure.notFound": "Keine Abbildung {id} in diesem Dokument.",
  "figure.loading": "Abbildung wird geladen…",
  "figure.notRendered": "Diese Abbildung konnte nicht dargestellt werden.",
  "figure.rendering": "Abbildung wird gerendert…",

  "peer.desktopMac": "dein Mac",
  "peer.desktopWindows": "dein Windows-PC",
  "peer.desktopLinux": "dein Linux-Rechner",
  "peer.desktopFallback": "dein Rechner",
  "peer.notice": "{name} ist noch auf {version}. Öffne Reading Partner dort, um auf {target} zu aktualisieren.",

  "sync.credentialsMissing":
    "Die automatische Synchronisierung ist an, aber dieses Gerät ist bei Google abgemeldet — es wird nichts synchronisiert.",
  "sync.engineStopped":
    "Die automatische Synchronisierung ist an, aber die Sync-Engine läuft nicht.",
  "sync.neverSynced": "Dieses Gerät hat noch nie erfolgreich synchronisiert.",
  "sync.neverSyncedWithError": "Dieses Gerät hat noch nie erfolgreich synchronisiert. Letzter Fehler: {error}",
  "sync.stalled": "Seit über einem Tag ist keine Synchronisierung mehr geglückt.",
  "sync.stalledWithError": "Seit über einem Tag ist keine Synchronisierung mehr geglückt. Letzter Fehler: {error}",
  "sync.lastFailed": "Letzte Synchronisierung fehlgeschlagen: {error}",

  "auth.notConfigured": "Google-Client nicht konfiguriert",
  "auth.tokenRequestFailed": "Google-Token-Anfrage fehlgeschlagen (HTTP {status}): {text}",
  "auth.redirectCaptureFailed": "Die Weiterleitung der Google-Anmeldung konnte nicht abgefangen werden: {error}",
  "auth.signInTimedOut": "Zeitüberschreitung beim Warten auf die Weiterleitung der Google-Anmeldung",
  "auth.authorizationError": "Google-Autorisierungsfehler: {error}",
  "auth.noRefreshToken":
    "Google hat kein Aktualisierungs-Token zurückgegeben; entferne die App unter myaccount.google.com und melde dich erneut an.",

  "image.noCanvasContext": "Das Bild konnte nicht verarbeitet werden (kein Canvas-Kontext).",
  "image.tooLarge": "Das Bild ist nach der Komprimierung noch zu groß ({mb} MB, maximal 5 MB).",
  "image.decodeFailed": "Das Bild konnte nicht decodiert werden.",
} satisfies Translation<typeof en>;
