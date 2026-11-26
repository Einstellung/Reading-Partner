import type { Translation } from "../types";
import type en from "./en";

export default {
  "readPage.thePage": "该页面",
  "readPage.reading": "正在阅读 {url}",
  "webSearch.searching": "正在搜索网页：{query}",

  "plugins.daysPositiveInteger": "days 必须是正整数",
  "plugins.daysMustBeAtMost": "days 最多为 {max}",

  "plugins.github.modeMustBe": "mode 必须是“trending”或“search”",
  "plugins.github.languageMustBeString": "language 必须是字符串",
  "plugins.github.fieldAppliesToSearchOnly": "{field} 仅适用于 search 模式",
  "plugins.github.periodMustBe": "period 必须是“day”“week”或“month”",
  "plugins.github.periodTrendingOnly": "period 仅适用于 trending 模式",
  "plugins.github.topicsMustBeStrings": "topics 必须是字符串列表",
  "plugins.github.minStarsMustBeNonNegative": "minStars 必须是非负整数",
  "plugins.github.notTrendingQuery": "不是 trending 查询",
  "plugins.github.notSearchQuery": "不是 search 查询",
  "plugins.github.httpError": "来自 {url} 的 HTTP {status}",
  "plugins.github.httpErrorRateLimited": "来自 {url} 的 HTTP {status}（速率限额已用尽）",
  "plugins.github.ossUnavailable": "OSS Insight 的 trending 数据不可用",
  "plugins.github.ossUnavailableSince": "OSS Insight 的 trending 数据自 {since} 起不可用",
  "plugins.github.ossUnavailableReason": "OSS Insight 的 trending 数据不可用：{reason}",
  "plugins.github.ossUnavailableSinceReason": "OSS Insight 的 trending 数据自 {since} 起不可用：{reason}",

  "plugins.s2.termsRequired": "terms 是必填项（字符串或字符串列表）",
  "plugins.s2.daysMustBePositiveNumber": "days 必须是正数",
  "plugins.s2.minCitationsMustBeNonNegative": "minCitations 必须是非负数",
  "plugins.s2.fieldsOfStudyMustBeStrings": "fieldsOfStudy 必须是字符串列表",

  "plugins.arxiv.unknownCategory": "未知的 arXiv 分类“{category}”（例如应为 cs.RO）",
  "plugins.arxiv.termsNoSearchableWords": "terms 中没有可搜索的词",
  "plugins.arxiv.needsCategoriesOrTerms": "查询需要 categories 或 terms",

  "plugins.huggingface.kindMustBeOneOf": "kind 必须是以下之一：{kinds}",
  "plugins.huggingface.daysPapersOnly": "days 仅适用于 papers",
  "plugins.huggingface.fieldAppliesToModelsDatasetsOnly": "{field} 仅适用于 models 和 datasets",
  "plugins.huggingface.fieldMustBeNonEmptyString": "{field} 必须是非空字符串",
  "plugins.huggingface.tagsMustBeNonEmptyStrings": "tags 必须是非空字符串列表",
  "plugins.huggingface.sortMustBeOneOf": "sort 必须是以下之一：{sorts}",
  "plugins.huggingface.includeConversionsModelsOnly": "includeConversions 仅适用于 models",
  "plugins.huggingface.includeConversionsMustBeBoolean": "includeConversions 必须是布尔值",
  "plugins.huggingface.nonJson": "Hugging Face 从 {url} 返回了非 JSON 内容",
  "plugins.huggingface.unexpectedShape": "Hugging Face 从 {url} 返回了意外的结构",

  "window.today": "今天",
  "window.lastDays": { other: "最近 {count} 天" },
} satisfies Translation<typeof en>;
