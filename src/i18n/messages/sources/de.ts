import type { Translation } from "../types";
import type en from "./en";

export default {
  "readPage.thePage": "die Seite",
  "readPage.reading": "{url} wird gelesen",
  "webSearch.searching": "Websuche: {query}",

  "plugins.daysPositiveInteger": "days muss eine positive ganze Zahl sein",
  "plugins.daysMustBeAtMost": "days darf höchstens {max} sein",

  "plugins.github.modeMustBe": 'mode muss "trending" oder "search" sein',
  "plugins.github.languageMustBeString": "language muss eine Zeichenkette sein",
  "plugins.github.fieldAppliesToSearchOnly": "{field} gilt nur im search-Modus",
  "plugins.github.periodMustBe": 'period muss "day", "week" oder "month" sein',
  "plugins.github.periodTrendingOnly": "period gilt nur im trending-Modus",
  "plugins.github.topicsMustBeStrings": "topics muss eine Liste von Zeichenketten sein",
  "plugins.github.minStarsMustBeNonNegative": "minStars muss eine nicht negative ganze Zahl sein",
  "plugins.github.notTrendingQuery": "keine trending-Abfrage",
  "plugins.github.notSearchQuery": "keine search-Abfrage",
  "plugins.github.httpError": "HTTP {status} von {url}",
  "plugins.github.httpErrorRateLimited": "HTTP {status} von {url} (Ratenlimit aufgebraucht)",
  "plugins.github.ossUnavailable": "Die trending-Daten von OSS Insight sind nicht verfügbar",
  "plugins.github.ossUnavailableSince": "Die trending-Daten von OSS Insight sind seit {since} nicht verfügbar",
  "plugins.github.ossUnavailableReason": "Die trending-Daten von OSS Insight sind nicht verfügbar: {reason}",
  "plugins.github.ossUnavailableSinceReason":
    "Die trending-Daten von OSS Insight sind seit {since} nicht verfügbar: {reason}",

  "plugins.s2.termsRequired": "terms ist erforderlich (eine Zeichenkette oder eine Liste von Zeichenketten)",
  "plugins.s2.daysMustBePositiveNumber": "days muss eine positive Zahl sein",
  "plugins.s2.minCitationsMustBeNonNegative": "minCitations muss eine nicht negative Zahl sein",
  "plugins.s2.fieldsOfStudyMustBeStrings": "fieldsOfStudy muss eine Liste von Zeichenketten sein",

  "plugins.arxiv.unknownCategory": "unbekannte arXiv-Kategorie „{category}“ (erwartet z. B. cs.RO)",
  "plugins.arxiv.termsNoSearchableWords": "terms enthält keine durchsuchbaren Wörter",
  "plugins.arxiv.needsCategoriesOrTerms": "die Abfrage benötigt categories oder terms",

  "plugins.huggingface.kindMustBeOneOf": "kind muss eines von Folgendem sein: {kinds}",
  "plugins.huggingface.daysPapersOnly": "days gilt nur für papers",
  "plugins.huggingface.fieldAppliesToModelsDatasetsOnly": "{field} gilt nur für models und datasets",
  "plugins.huggingface.fieldMustBeNonEmptyString": "{field} muss eine nicht leere Zeichenkette sein",
  "plugins.huggingface.tagsMustBeNonEmptyStrings": "tags muss eine Liste nicht leerer Zeichenketten sein",
  "plugins.huggingface.sortMustBeOneOf": "sort muss eines von Folgendem sein: {sorts}",
  "plugins.huggingface.includeConversionsModelsOnly": "includeConversions gilt nur für models",
  "plugins.huggingface.includeConversionsMustBeBoolean": "includeConversions muss ein Wahrheitswert sein",
  "plugins.huggingface.nonJson": "Hugging Face hat von {url} kein JSON zurückgegeben",
  "plugins.huggingface.unexpectedShape": "Hugging Face hat von {url} eine unerwartete Struktur zurückgegeben",

  "window.today": "heute",
  "window.lastDays": { one: "letzter {count} Tag", other: "letzte {count} Tage" },
} satisfies Translation<typeof en>;
