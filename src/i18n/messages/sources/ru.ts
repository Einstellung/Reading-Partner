import type { Translation } from "../types";
import type en from "./en";

export default {
  "readPage.thePage": "страницу",
  "readPage.reading": "Чтение {url}",
  "webSearch.searching": "Поиск в интернете: {query}",

  "plugins.daysPositiveInteger": "days должно быть положительным целым числом",
  "plugins.daysMustBeAtMost": "days должно быть не более {max}",

  "plugins.github.modeMustBe": 'mode должно быть "trending" или "search"',
  "plugins.github.languageMustBeString": "language должно быть строкой",
  "plugins.github.fieldAppliesToSearchOnly": "{field} применяется только в режиме search",
  "plugins.github.periodMustBe": 'period должно быть "day", "week" или "month"',
  "plugins.github.periodTrendingOnly": "period применяется только в режиме trending",
  "plugins.github.topicsMustBeStrings": "topics должно быть списком строк",
  "plugins.github.minStarsMustBeNonNegative": "minStars должно быть неотрицательным целым числом",
  "plugins.github.notTrendingQuery": "это не запрос trending",
  "plugins.github.notSearchQuery": "это не запрос search",
  "plugins.github.httpError": "HTTP {status} от {url}",
  "plugins.github.httpErrorRateLimited": "HTTP {status} от {url} (лимит запросов исчерпан)",
  "plugins.github.ossUnavailable": "Данные trending от OSS Insight недоступны",
  "plugins.github.ossUnavailableSince": "Данные trending от OSS Insight недоступны с {since}",
  "plugins.github.ossUnavailableReason": "Данные trending от OSS Insight недоступны: {reason}",
  "plugins.github.ossUnavailableSinceReason": "Данные trending от OSS Insight недоступны с {since}: {reason}",

  "plugins.s2.termsRequired": "terms обязателен (строка или список строк)",
  "plugins.s2.daysMustBePositiveNumber": "days должно быть положительным числом",
  "plugins.s2.minCitationsMustBeNonNegative": "minCitations должно быть неотрицательным числом",
  "plugins.s2.fieldsOfStudyMustBeStrings": "fieldsOfStudy должно быть списком строк",

  "plugins.arxiv.unknownCategory": 'неизвестная категория arXiv "{category}" (ожидается, например, cs.RO)',
  "plugins.arxiv.termsNoSearchableWords": "terms не содержит слов для поиска",
  "plugins.arxiv.needsCategoriesOrTerms": "запросу нужны categories или terms",

  "plugins.huggingface.kindMustBeOneOf": "kind должно быть одним из: {kinds}",
  "plugins.huggingface.daysPapersOnly": "days применяется только к papers",
  "plugins.huggingface.fieldAppliesToModelsDatasetsOnly": "{field} применяется только к models и datasets",
  "plugins.huggingface.fieldMustBeNonEmptyString": "{field} должно быть непустой строкой",
  "plugins.huggingface.tagsMustBeNonEmptyStrings": "tags должно быть списком непустых строк",
  "plugins.huggingface.sortMustBeOneOf": "sort должно быть одним из: {sorts}",
  "plugins.huggingface.includeConversionsModelsOnly": "includeConversions применяется только к models",
  "plugins.huggingface.includeConversionsMustBeBoolean": "includeConversions должно быть логическим значением",
  "plugins.huggingface.nonJson": "Hugging Face вернул не-JSON ответ с {url}",
  "plugins.huggingface.unexpectedShape": "Hugging Face вернул неожиданную структуру с {url}",

  "window.today": "сегодня",
  "window.lastDays": { one: "последний {count} день", few: "последние {count} дня", many: "последние {count} дней", other: "последние {count} дня" },
} satisfies Translation<typeof en>;
