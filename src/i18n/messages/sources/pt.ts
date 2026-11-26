import type { Translation } from "../types";
import type en from "./en";

// Brazilian Portuguese wording.
export default {
  "readPage.thePage": "a página",
  "readPage.reading": "Lendo {url}",
  "webSearch.searching": "Pesquisando na web: {query}",

  "plugins.daysPositiveInteger": "days precisa ser um inteiro positivo",
  "plugins.daysMustBeAtMost": "days deve ser no máximo {max}",

  "plugins.github.modeMustBe": 'mode precisa ser "trending" ou "search"',
  "plugins.github.languageMustBeString": "language precisa ser uma string",
  "plugins.github.fieldAppliesToSearchOnly": "{field} só se aplica ao modo search",
  "plugins.github.periodMustBe": 'period precisa ser "day", "week" ou "month"',
  "plugins.github.periodTrendingOnly": "period só se aplica ao modo trending",
  "plugins.github.topicsMustBeStrings": "topics precisa ser uma lista de strings",
  "plugins.github.minStarsMustBeNonNegative": "minStars precisa ser um inteiro não negativo",
  "plugins.github.notTrendingQuery": "não é uma consulta trending",
  "plugins.github.notSearchQuery": "não é uma consulta search",
  "plugins.github.httpError": "HTTP {status} de {url}",
  "plugins.github.httpErrorRateLimited": "HTTP {status} de {url} (limite de requisições esgotado)",
  "plugins.github.ossUnavailable": "Os dados trending do OSS Insight estão indisponíveis",
  "plugins.github.ossUnavailableSince": "Os dados trending do OSS Insight estão indisponíveis desde {since}",
  "plugins.github.ossUnavailableReason": "Os dados trending do OSS Insight estão indisponíveis: {reason}",
  "plugins.github.ossUnavailableSinceReason":
    "Os dados trending do OSS Insight estão indisponíveis desde {since}: {reason}",

  "plugins.s2.termsRequired": "terms é obrigatório (uma string ou uma lista de strings)",
  "plugins.s2.daysMustBePositiveNumber": "days precisa ser um número positivo",
  "plugins.s2.minCitationsMustBeNonNegative": "minCitations precisa ser um número não negativo",
  "plugins.s2.fieldsOfStudyMustBeStrings": "fieldsOfStudy precisa ser uma lista de strings",

  "plugins.arxiv.unknownCategory": 'categoria arXiv desconhecida "{category}" (esperado, por exemplo, cs.RO)',
  "plugins.arxiv.termsNoSearchableWords": "terms não contém palavras pesquisáveis",
  "plugins.arxiv.needsCategoriesOrTerms": "a consulta precisa de categories ou terms",

  "plugins.huggingface.kindMustBeOneOf": "kind precisa ser um de: {kinds}",
  "plugins.huggingface.daysPapersOnly": "days só se aplica a papers",
  "plugins.huggingface.fieldAppliesToModelsDatasetsOnly": "{field} só se aplica a models e datasets",
  "plugins.huggingface.fieldMustBeNonEmptyString": "{field} precisa ser uma string não vazia",
  "plugins.huggingface.tagsMustBeNonEmptyStrings": "tags precisa ser uma lista de strings não vazias",
  "plugins.huggingface.sortMustBeOneOf": "sort precisa ser um de: {sorts}",
  "plugins.huggingface.includeConversionsModelsOnly": "includeConversions só se aplica a models",
  "plugins.huggingface.includeConversionsMustBeBoolean": "includeConversions precisa ser um booleano",
  "plugins.huggingface.nonJson": "O Hugging Face retornou conteúdo não-JSON de {url}",
  "plugins.huggingface.unexpectedShape": "O Hugging Face retornou uma estrutura inesperada de {url}",

  "window.today": "hoje",
  "window.lastDays": { one: "último {count} dia", other: "últimos {count} dias" },
} satisfies Translation<typeof en>;
