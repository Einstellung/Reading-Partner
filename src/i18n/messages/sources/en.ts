// Sources: the page-reading tool's label (sources/read-page-tool.ts) and the
// errors a source plugin can surface (sources/plugins/). The source every
// other locale is typed against.

export default {
  "readPage.thePage": "the page",
  "readPage.reading": "Reading {url}",
  "webSearch.searching": "Searching the web: {query}",

  "plugins.daysPositiveInteger": "days must be a positive integer",
  "plugins.daysMustBeAtMost": "days must be at most {max}",

  "plugins.github.modeMustBe": 'mode must be "trending" or "search"',
  "plugins.github.languageMustBeString": "language must be a string",
  "plugins.github.fieldAppliesToSearchOnly": "{field} applies to search mode only",
  "plugins.github.periodMustBe": 'period must be "day", "week" or "month"',
  "plugins.github.periodTrendingOnly": "period applies to trending mode only",
  "plugins.github.topicsMustBeStrings": "topics must be a list of strings",
  "plugins.github.minStarsMustBeNonNegative": "minStars must be a non-negative integer",
  "plugins.github.notTrendingQuery": "not a trending query",
  "plugins.github.notSearchQuery": "not a search query",
  "plugins.github.httpError": "HTTP {status} from {url}",
  "plugins.github.httpErrorRateLimited": "HTTP {status} from {url} (rate limit spent)",
  "plugins.github.ossUnavailable": "OSS Insight trending unavailable",
  "plugins.github.ossUnavailableSince": "OSS Insight trending unavailable since {since}",
  "plugins.github.ossUnavailableReason": "OSS Insight trending unavailable: {reason}",
  "plugins.github.ossUnavailableSinceReason": "OSS Insight trending unavailable since {since}: {reason}",

  "plugins.s2.termsRequired": "terms is required (a string or a list of strings)",
  "plugins.s2.daysMustBePositiveNumber": "days must be a positive number",
  "plugins.s2.minCitationsMustBeNonNegative": "minCitations must be a non-negative number",
  "plugins.s2.fieldsOfStudyMustBeStrings": "fieldsOfStudy must be a list of strings",

  "plugins.arxiv.unknownCategory": 'unknown arXiv category "{category}" (expected e.g. cs.RO)',
  "plugins.arxiv.termsNoSearchableWords": "terms contain no searchable words",
  "plugins.arxiv.needsCategoriesOrTerms": "query needs categories or terms",

  "plugins.huggingface.kindMustBeOneOf": "kind must be one of {kinds}",
  "plugins.huggingface.daysPapersOnly": "days applies to papers only",
  "plugins.huggingface.fieldAppliesToModelsDatasetsOnly": "{field} applies to models and datasets only",
  "plugins.huggingface.fieldMustBeNonEmptyString": "{field} must be a non-empty string",
  "plugins.huggingface.tagsMustBeNonEmptyStrings": "tags must be a list of non-empty strings",
  "plugins.huggingface.sortMustBeOneOf": "sort must be one of {sorts}",
  "plugins.huggingface.includeConversionsModelsOnly": "includeConversions applies to models only",
  "plugins.huggingface.includeConversionsMustBeBoolean": "includeConversions must be a boolean",
  "plugins.huggingface.nonJson": "Hugging Face returned non-JSON from {url}",
  "plugins.huggingface.unexpectedShape": "Hugging Face returned an unexpected shape from {url}",

  // The time window in a source's subtitle (plugins/arxiv.ts, plugins/huggingface.ts).
  "window.today": "today",
  "window.lastDays": { one: "last {count} day", other: "last {count} days" },
} as const;
