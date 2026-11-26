import type { Translation } from "../types";
import type en from "./en";

export default {
  "readPage.thePage": "la page",
  "readPage.reading": "Lecture de {url}",
  "webSearch.searching": "Recherche sur le web : {query}",

  "plugins.daysPositiveInteger": "days doit être un entier positif",
  "plugins.daysMustBeAtMost": "days doit être au maximum {max}",

  "plugins.github.modeMustBe": 'mode doit être "trending" ou "search"',
  "plugins.github.languageMustBeString": "language doit être une chaîne de caractères",
  "plugins.github.fieldAppliesToSearchOnly": "{field} ne s'applique qu'au mode search",
  "plugins.github.periodMustBe": 'period doit être "day", "week" ou "month"',
  "plugins.github.periodTrendingOnly": "period ne s'applique qu'au mode trending",
  "plugins.github.topicsMustBeStrings": "topics doit être une liste de chaînes",
  "plugins.github.minStarsMustBeNonNegative": "minStars doit être un entier non négatif",
  "plugins.github.notTrendingQuery": "ce n'est pas une requête trending",
  "plugins.github.notSearchQuery": "ce n'est pas une requête search",
  "plugins.github.httpError": "HTTP {status} depuis {url}",
  "plugins.github.httpErrorRateLimited": "HTTP {status} depuis {url} (quota de requêtes épuisé)",
  "plugins.github.ossUnavailable": "Les données trending d'OSS Insight sont indisponibles",
  "plugins.github.ossUnavailableSince": "Les données trending d'OSS Insight sont indisponibles depuis {since}",
  "plugins.github.ossUnavailableReason": "Les données trending d'OSS Insight sont indisponibles : {reason}",
  "plugins.github.ossUnavailableSinceReason":
    "Les données trending d'OSS Insight sont indisponibles depuis {since} : {reason}",

  "plugins.s2.termsRequired": "terms est obligatoire (une chaîne ou une liste de chaînes)",
  "plugins.s2.daysMustBePositiveNumber": "days doit être un nombre positif",
  "plugins.s2.minCitationsMustBeNonNegative": "minCitations doit être un nombre non négatif",
  "plugins.s2.fieldsOfStudyMustBeStrings": "fieldsOfStudy doit être une liste de chaînes",

  "plugins.arxiv.unknownCategory": "catégorie arXiv inconnue « {category} » (attendu par ex. cs.RO)",
  "plugins.arxiv.termsNoSearchableWords": "terms ne contient aucun mot cherchable",
  "plugins.arxiv.needsCategoriesOrTerms": "la requête nécessite categories ou terms",

  "plugins.huggingface.kindMustBeOneOf": "kind doit être l'un de : {kinds}",
  "plugins.huggingface.daysPapersOnly": "days ne s'applique qu'aux papers",
  "plugins.huggingface.fieldAppliesToModelsDatasetsOnly": "{field} ne s'applique qu'aux models et datasets",
  "plugins.huggingface.fieldMustBeNonEmptyString": "{field} doit être une chaîne non vide",
  "plugins.huggingface.tagsMustBeNonEmptyStrings": "tags doit être une liste de chaînes non vides",
  "plugins.huggingface.sortMustBeOneOf": "sort doit être l'un de : {sorts}",
  "plugins.huggingface.includeConversionsModelsOnly": "includeConversions ne s'applique qu'aux models",
  "plugins.huggingface.includeConversionsMustBeBoolean": "includeConversions doit être un booléen",
  "plugins.huggingface.nonJson": "Hugging Face a renvoyé du contenu non JSON depuis {url}",
  "plugins.huggingface.unexpectedShape": "Hugging Face a renvoyé une structure inattendue depuis {url}",

  "window.today": "aujourd'hui",
  "window.lastDays": { one: "{count} dernier jour", other: "{count} derniers jours" },
} satisfies Translation<typeof en>;
