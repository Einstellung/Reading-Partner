import type { Translation } from "../types";
import type en from "./en";

export default {
  title: "Einstellungen",
  done: "Fertig",
  "tab.account": "Konto",
  "tab.features": "Funktionen",
  "tab.optional": "Optional",
  connected: "Verbunden",
  save: "Sichern",
  signOut: "Abmelden",
  apiKey: "API-Schlüssel",

  "thinking.off": "Aus",
  "thinking.low": "Niedrig",
  "thinking.medium": "Mittel",
  "thinking.high": "Hoch",

  "account.providers": "Anbieter",
  "account.signInWith": "Mit {name} anmelden",
  "account.defaultConversation": "Standardunterhaltung",
  "account.connectFirst": "Verbinde oben einen Anbieter, um einen Standard zu wählen.",
  "account.provider": "Anbieter",
  "account.model": "Modell",
  "account.select": "Auswählen …",
  "account.contextHint":
    "Die Zahl neben jedem Modell ist sein Kontextfenster. Diese App legt ein ganzes Buch hinein; bei einem kleineren Fenster lässt eine Antwort Material weg, damit es passt, und sagt, was sie weggelassen hat.",
  "account.everydayModel": "Modell für Routinearbeit",
  "account.sameAsChat": "Wie beim Chat",
  "account.everydayHint":
    "Die Routinearbeit läuft hier statt auf dem Modell oben: Mahlzeiten und das nächtliche Briefing. Niemand wartet darauf, ein günstigeres Modell kostet dich also nichts; welche Aufgaben dazugehören, entscheidet die App, nicht diese Einstellung. Es nutzt den Anbieter oben.",
  "account.briefing": "Briefing",
  "account.screening": "Sichtung",
  "account.analysis": "Analyse",
  "account.briefingHint":
    "Das Briefing entsteht über Nacht aus allen Quellen, ob du es liest oder nicht. Die Sichtung liest die Schlagzeilen des Tages und entscheidet, welche Artikel sich zu laden lohnen – diese Stufe sollte niedrig bleiben; die Analyse liest die, die durchgekommen sind.",
  "account.thinking": "Denken",
  "account.chat": "Chat",
  "account.lessonPrep": "Unterrichtsvorbereitung",
  "account.thinkingHint":
    "Adaptive Modelle entscheiden pro Frage, wie viel sie tatsächlich nachdenken; höher = gründlicher, aber langsamer.",
  "account.sync": "Synchronisierung",

  "oauth.signInFailed": "Anmeldung fehlgeschlagen",
  "oauth.openFailed": "Die Anmeldeseite konnte nicht geöffnet werden",
  "oauth.invalidCode": "Ungültiger Code",
  "oauth.pasteHintDevice":
    "Kopiere nach der Anmeldung die Adressleiste (die localhost-URL, die nicht lädt) und füge sie hier ein.",
  "oauth.pasteHintCode": "Füge den Code ein, der nach der Freigabe angezeigt wird.",
  "oauth.opening": "Anmeldeseite wird geöffnet …",
  "oauth.completeInBrowser": "Schließe die Autorisierung im Browser ab …",
  "oauth.withCode": "Mit einem Code anmelden",
  "oauth.pastePlaceholder": "Anmeldecode oder URL einfügen",
  "oauth.submit": "Senden",
  "oauth.signsOutOthers": "Eine Anmeldung hier meldet dich bei anderen Anbietern ab.",
  "oauth.requestingCode": "Anmeldecode wird angefordert …",
  "oauth.openPage": "Anmeldeseite öffnen",
  "oauth.enterCode": "Gib diesen Code auf {url} ein. Warte auf die Autorisierung …",
  "oauth.cancel": "Abbrechen",
  "oauth.pasteInstead": "Stattdessen die Anmelde-URL einfügen",
  "oauth.tryAgain": "Erneut versuchen",

  "key.replace": "API-Schlüssel ersetzen",
  "key.signsOutOthers": "Ein hier gesicherter Schlüssel meldet dich bei anderen Anbietern ab.",

  "sync.drive": "Google Drive",
  "sync.never": "Nie",
  "sync.justNow": "Gerade eben",
  "sync.minutesAgo": { one: "Vor {count} Minute", other: "Vor {count} Minuten" },
  "sync.failed": "Synchronisierung fehlgeschlagen",
  "sync.notConfigured": "Google-Client ist nicht konfiguriert.",
  "sync.signIn": "Mit Google anmelden",
  "sync.signedOutNote":
    "Alles seit der letzten Synchronisierung liegt nur auf diesem Gerät. Melde dich erneut an, um fortzufahren; lokal geht nichts verloren.",
  "sync.pitch": "Lesefortschritt, Markierungen und Bücher mit deinem eigenen Google Drive synchronisieren.",
  "sync.completeInBrowser": "Schließe die Anmeldung im Browser ab …",
  "sync.lastSync": "Zuletzt synchronisiert: {time}",
  "sync.auto": "Automatisch synchronisieren",
  "sync.running": "Wird synchronisiert …",
  "sync.now": "Jetzt synchronisieren",

  "features.general": "Allgemein",
  "features.language": "Sprache",
  "features.languageAuto": "Automatisch (App: System, KI: deine Sprache)",
  "features.languageHint":
    "Die Sprache der App und von allem, was die KI schreibt: Chat-Antworten, Notizen und das Nachrichten-Briefing. Bei „Automatisch“ erscheint die App in der Systemsprache und die KI antwortet in der Sprache, in der du schreibst. Die Spracherkennung folgt immer dem, was du sprichst.",
  "features.paper": "Papierhintergrund",
  "features.paperHint":
    "Macht das Weiß hinter der ganzen App – Chats, Regale, Seitenleisten, dieses Fenster und die Seiten eines Buchs – zu einem gebrochenen Papierweiß. Es gibt nur diesen einen Ton und keine dunklere Stufe; das ist kein Dunkelmodus. Die Wahl bleibt auf diesem Gerät.",
  "features.reading": "Lesen",
  "features.lumen": "Lumen anzeigen",
  "features.lumenHint":
    "Lumen steht in der Ecke jedes Bildschirms, auch im Reader. Aus bleibt die Ecke leer; der Lumen-Knopf in der Seitenleiste, auf dem Startbildschirm des Handys und im Mehr-Menü des Readers holt es zurück. Die Wahl bleibt auf diesem Gerät.",
  "features.briefing": "Briefing",
  "features.collect": "Quellen auf diesem Computer sammeln",
  "features.collectHint":
    "Jede Quelle wird nach ihrem eigenen Zeitplan abgefragt, und was sie veröffentlicht hat, wird bis zum Erstellen des Tagesbriefings aufbewahrt. Aus: Dieser Rechner sammelt überhaupt nicht mehr, und ein anderer Sammler übernimmt, falls vorhanden.",
  "features.thisComputer": "Dieser Computer",
  "features.role": "Dieser Rechner ist ein",
  "features.roleCollector": "Sammler – liest die Quellen hier",
  "features.roleReader": "Leser – liest, was ein anderer Rechner gesammelt hat",
  "features.roleHint":
    "Ein Sammler liest deine abonnierten Seiten den ganzen Tag und veröffentlicht das Briefing für deine anderen Geräte; ein Leser zeigt, was ein Sammler veröffentlicht hat, und lädt selbst nie etwas von einer Seite. Smartphones und Tablets sind immer Leser. Wenn zwei Rechner sammeln, arbeitet der, der am längsten läuft.",
  "features.autostart": "Reading Partner beim Start dieses Computers öffnen",
  "features.autostartHint":
    "Standardmäßig aus. Schalte es auf dem Rechner ein, der deine Quellen den ganzen Tag sammeln soll – zusammen mit dem Symbol in der Menüleiste bzw. im Infobereich entsteht das Briefing, ob du die App geöffnet hast oder nicht. Diese Einstellung gehört zu diesem Computer und wird nicht auf deine anderen Geräte übertragen.",

  "optional.intro":
    "Schlüssel für externe Dienste, alle optional. Die beiden Sprachschlüssel werden mit den Zugangsdaten dieses Geräts gespeichert und nie synchronisiert, daher braucht jedes Gerät seine eigenen.",
  "optional.meals": "Mahlzeiten",
  "optional.mealsHint":
    "Plane Frühstück, Mittag- und Abendessen der Woche, führe die Einkaufsliste und sag Bescheid, wenn du etwas anderes gegessen hast.",
  "optional.lessonPrep": "Unterrichtsvorbereitung",
  "optional.s2Key": "Semantic-Scholar-API-Schlüssel",
  "optional.s2Placeholder": "Optional",
  "optional.s2Hint":
    "Ein kostenloser Schlüssel von semanticscholar.org umgeht die gemeinsamen Ratenlimits, an denen das Laden von Papers hängen bleibt.",
  "optional.voiceInput": "Spracheingabe",
  "optional.voiceOutput": "Sprachausgabe",
  "optional.dictationLanguage": "Diktiersprache",
  "optional.dictationHint":
    "Die Sprache, auf die das iPhone hört, wenn du die Leiste gedrückt hältst und sprichst. Die Sprache wird auf dem Telefon transkribiert und nie hochgeladen. Wer eine andere Sprache spricht, bekommt keine grobe Abschrift, sondern eine überzeugend falsche – stell also die Sprache ein, die du wirklich sprichst.",
  "optional.speechKey": "Sprachausgabe-API-Schlüssel",
  "optional.speechKeyReplace": "Sprachausgabe-API-Schlüssel ersetzen",
  "optional.speechHint":
    "Ein Xiaomi-MiMo-Schlüssel für die Stimme, die Antworten vorliest. Ohne ihn bleibt die App stumm und alles andere funktioniert wie bisher.",
  "optional.sttKey": "Spracherkennungs-API-Schlüssel",
  "optional.sttKeyReplace": "Spracherkennungs-API-Schlüssel ersetzen",
  "optional.model": "Modell",
  "optional.baseUrl": "Basis-URL",
  "optional.sttHint":
    "Halte das Mikrofon im Chatfeld gedrückt, um zu sprechen. Der SenseVoice-Tarif von SiliconFlow ist kostenlos und sein API-Schlüssel funktioniert sofort; jeder OpenAI-kompatible Transkriptionsdienst geht ebenfalls.",
} satisfies Translation<typeof en>;
