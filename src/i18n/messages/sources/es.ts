import type { Translation } from "../types";
import type en from "./en";

export default {
  "readPage.thePage": "la página",
  "readPage.reading": "Leyendo {url}",
  "webSearch.searching": "Buscando en la web: {query}",

  "plugins.daysPositiveInteger": "days debe ser un entero positivo",
  "plugins.daysMustBeAtMost": "days debe ser como máximo {max}",

  "plugins.github.modeMustBe": 'mode debe ser "trending" o "search"',
  "plugins.github.languageMustBeString": "language debe ser una cadena de texto",
  "plugins.github.fieldAppliesToSearchOnly": "{field} solo se aplica al modo search",
  "plugins.github.periodMustBe": 'period debe ser "day", "week" o "month"',
  "plugins.github.periodTrendingOnly": "period solo se aplica al modo trending",
  "plugins.github.topicsMustBeStrings": "topics debe ser una lista de cadenas de texto",
  "plugins.github.minStarsMustBeNonNegative": "minStars debe ser un entero no negativo",
  "plugins.github.notTrendingQuery": "no es una consulta trending",
  "plugins.github.notSearchQuery": "no es una consulta search",
  "plugins.github.httpError": "HTTP {status} desde {url}",
  "plugins.github.httpErrorRateLimited": "HTTP {status} desde {url} (límite de solicitudes agotado)",
  "plugins.github.ossUnavailable": "Los datos trending de OSS Insight no están disponibles",
  "plugins.github.ossUnavailableSince": "Los datos trending de OSS Insight no están disponibles desde {since}",
  "plugins.github.ossUnavailableReason": "Los datos trending de OSS Insight no están disponibles: {reason}",
  "plugins.github.ossUnavailableSinceReason":
    "Los datos trending de OSS Insight no están disponibles desde {since}: {reason}",

  "plugins.s2.termsRequired": "terms es obligatorio (una cadena de texto o una lista de cadenas)",
  "plugins.s2.daysMustBePositiveNumber": "days debe ser un número positivo",
  "plugins.s2.minCitationsMustBeNonNegative": "minCitations debe ser un número no negativo",
  "plugins.s2.fieldsOfStudyMustBeStrings": "fieldsOfStudy debe ser una lista de cadenas de texto",

  "plugins.arxiv.unknownCategory": 'categoría de arXiv desconocida "{category}" (se esperaba, p. ej., cs.RO)',
  "plugins.arxiv.termsNoSearchableWords": "terms no contiene palabras que se puedan buscar",
  "plugins.arxiv.needsCategoriesOrTerms": "la consulta necesita categories o terms",

  "plugins.huggingface.kindMustBeOneOf": "kind debe ser uno de: {kinds}",
  "plugins.huggingface.daysPapersOnly": "days solo se aplica a papers",
  "plugins.huggingface.fieldAppliesToModelsDatasetsOnly": "{field} solo se aplica a models y datasets",
  "plugins.huggingface.fieldMustBeNonEmptyString": "{field} debe ser una cadena no vacía",
  "plugins.huggingface.tagsMustBeNonEmptyStrings": "tags debe ser una lista de cadenas no vacías",
  "plugins.huggingface.sortMustBeOneOf": "sort debe ser uno de: {sorts}",
  "plugins.huggingface.includeConversionsModelsOnly": "includeConversions solo se aplica a models",
  "plugins.huggingface.includeConversionsMustBeBoolean": "includeConversions debe ser un booleano",
  "plugins.huggingface.nonJson": "Hugging Face devolvió contenido que no es JSON desde {url}",
  "plugins.huggingface.unexpectedShape": "Hugging Face devolvió una estructura inesperada desde {url}",

  "window.today": "hoy",
  "window.lastDays": { one: "último {count} día", other: "últimos {count} días" },
} satisfies Translation<typeof en>;
