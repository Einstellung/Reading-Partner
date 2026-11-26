import type { Translation } from "../types";
import type en from "./en";

export default {
  "readPage.thePage": "このページ",
  "readPage.reading": "{url} を読み込み中",
  "webSearch.searching": "ウェブを検索中：{query}",

  "plugins.daysPositiveInteger": "days は正の整数である必要があります",
  "plugins.daysMustBeAtMost": "days は最大 {max} である必要があります",

  "plugins.github.modeMustBe": "mode は「trending」か「search」である必要があります",
  "plugins.github.languageMustBeString": "language は文字列である必要があります",
  "plugins.github.fieldAppliesToSearchOnly": "{field} は search モードのみで使えます",
  "plugins.github.periodMustBe": "period は「day」「week」「month」のいずれかである必要があります",
  "plugins.github.periodTrendingOnly": "period は trending モードのみで使えます",
  "plugins.github.topicsMustBeStrings": "topics は文字列のリストである必要があります",
  "plugins.github.minStarsMustBeNonNegative": "minStars は 0 以上の整数である必要があります",
  "plugins.github.notTrendingQuery": "trending クエリではありません",
  "plugins.github.notSearchQuery": "search クエリではありません",
  "plugins.github.httpError": "{url} から HTTP {status}",
  "plugins.github.httpErrorRateLimited": "{url} から HTTP {status}（レート制限を使い切りました）",
  "plugins.github.ossUnavailable": "OSS Insight の trending データが利用できません",
  "plugins.github.ossUnavailableSince": "OSS Insight の trending データは {since} 以降利用できません",
  "plugins.github.ossUnavailableReason": "OSS Insight の trending データが利用できません: {reason}",
  "plugins.github.ossUnavailableSinceReason":
    "OSS Insight の trending データは {since} 以降利用できません: {reason}",

  "plugins.s2.termsRequired": "terms は必須です（文字列または文字列のリスト）",
  "plugins.s2.daysMustBePositiveNumber": "days は正の数である必要があります",
  "plugins.s2.minCitationsMustBeNonNegative": "minCitations は 0 以上の数である必要があります",
  "plugins.s2.fieldsOfStudyMustBeStrings": "fieldsOfStudy は文字列のリストである必要があります",

  "plugins.arxiv.unknownCategory": "不明な arXiv カテゴリ「{category}」（例: cs.RO）",
  "plugins.arxiv.termsNoSearchableWords": "terms に検索可能な語がありません",
  "plugins.arxiv.needsCategoriesOrTerms": "クエリには categories か terms が必要です",

  "plugins.huggingface.kindMustBeOneOf": "kind は次のいずれかである必要があります: {kinds}",
  "plugins.huggingface.daysPapersOnly": "days は papers のみで使えます",
  "plugins.huggingface.fieldAppliesToModelsDatasetsOnly": "{field} は models と datasets のみで使えます",
  "plugins.huggingface.fieldMustBeNonEmptyString": "{field} は空でない文字列である必要があります",
  "plugins.huggingface.tagsMustBeNonEmptyStrings": "tags は空でない文字列のリストである必要があります",
  "plugins.huggingface.sortMustBeOneOf": "sort は次のいずれかである必要があります: {sorts}",
  "plugins.huggingface.includeConversionsModelsOnly": "includeConversions は models のみで使えます",
  "plugins.huggingface.includeConversionsMustBeBoolean": "includeConversions は真偽値である必要があります",
  "plugins.huggingface.nonJson": "Hugging Face が {url} から JSON 以外を返しました",
  "plugins.huggingface.unexpectedShape": "Hugging Face が {url} から予期しない形式を返しました",

  "window.today": "今日",
  "window.lastDays": { other: "過去{count}日" },
} satisfies Translation<typeof en>;
