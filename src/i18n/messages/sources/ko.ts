import type { Translation } from "../types";
import type en from "./en";

export default {
  "readPage.thePage": "이 페이지",
  "readPage.reading": "{url} 읽는 중",
  "webSearch.searching": "웹 검색 중: {query}",

  "plugins.daysPositiveInteger": "days는 양의 정수여야 합니다",
  "plugins.daysMustBeAtMost": "days는 최대 {max}이어야 합니다",

  "plugins.github.modeMustBe": "mode는 \"trending\" 또는 \"search\"여야 합니다",
  "plugins.github.languageMustBeString": "language는 문자열이어야 합니다",
  "plugins.github.fieldAppliesToSearchOnly": "{field}는 search 모드에서만 적용됩니다",
  "plugins.github.periodMustBe": "period는 \"day\", \"week\", \"month\" 중 하나여야 합니다",
  "plugins.github.periodTrendingOnly": "period는 trending 모드에서만 적용됩니다",
  "plugins.github.topicsMustBeStrings": "topics는 문자열 목록이어야 합니다",
  "plugins.github.minStarsMustBeNonNegative": "minStars는 0 이상의 정수여야 합니다",
  "plugins.github.notTrendingQuery": "trending 쿼리가 아닙니다",
  "plugins.github.notSearchQuery": "search 쿼리가 아닙니다",
  "plugins.github.httpError": "{url}에서 HTTP {status}",
  "plugins.github.httpErrorRateLimited": "{url}에서 HTTP {status} (요청 한도 소진)",
  "plugins.github.ossUnavailable": "OSS Insight의 trending 데이터를 사용할 수 없습니다",
  "plugins.github.ossUnavailableSince": "OSS Insight의 trending 데이터를 {since} 이후로 사용할 수 없습니다",
  "plugins.github.ossUnavailableReason": "OSS Insight의 trending 데이터를 사용할 수 없습니다: {reason}",
  "plugins.github.ossUnavailableSinceReason":
    "OSS Insight의 trending 데이터를 {since} 이후로 사용할 수 없습니다: {reason}",

  "plugins.s2.termsRequired": "terms는 필수입니다 (문자열 또는 문자열 목록)",
  "plugins.s2.daysMustBePositiveNumber": "days는 양수여야 합니다",
  "plugins.s2.minCitationsMustBeNonNegative": "minCitations는 0 이상의 수여야 합니다",
  "plugins.s2.fieldsOfStudyMustBeStrings": "fieldsOfStudy는 문자열 목록이어야 합니다",

  "plugins.arxiv.unknownCategory": "알 수 없는 arXiv 분류 \"{category}\" (예: cs.RO)",
  "plugins.arxiv.termsNoSearchableWords": "terms에 검색 가능한 단어가 없습니다",
  "plugins.arxiv.needsCategoriesOrTerms": "쿼리에는 categories 또는 terms가 필요합니다",

  "plugins.huggingface.kindMustBeOneOf": "kind는 다음 중 하나여야 합니다: {kinds}",
  "plugins.huggingface.daysPapersOnly": "days는 papers에만 적용됩니다",
  "plugins.huggingface.fieldAppliesToModelsDatasetsOnly": "{field}는 models와 datasets에만 적용됩니다",
  "plugins.huggingface.fieldMustBeNonEmptyString": "{field}는 비어 있지 않은 문자열이어야 합니다",
  "plugins.huggingface.tagsMustBeNonEmptyStrings": "tags는 비어 있지 않은 문자열 목록이어야 합니다",
  "plugins.huggingface.sortMustBeOneOf": "sort는 다음 중 하나여야 합니다: {sorts}",
  "plugins.huggingface.includeConversionsModelsOnly": "includeConversions는 models에만 적용됩니다",
  "plugins.huggingface.includeConversionsMustBeBoolean": "includeConversions는 불리언이어야 합니다",
  "plugins.huggingface.nonJson": "Hugging Face가 {url}에서 JSON이 아닌 응답을 반환했습니다",
  "plugins.huggingface.unexpectedShape": "Hugging Face가 {url}에서 예상치 못한 형식을 반환했습니다",

  "window.today": "오늘",
  "window.lastDays": { other: "최근 {count}일" },
} satisfies Translation<typeof en>;
