// Sources: the source-list page (ui/components/info/SourcesPage.tsx), the
// site sign-in state it draws (info/sources/site-session.ts), the pipe-type
// phrase shared by the page and the add-source chat cards (info/sources/
// probe.ts), the add-source AI tools' progress labels and receipts
// (info/sources/source-tools.ts), the tasking sub-agent's progress labels
// (info/tasking/), the page-reading tool's label (info/extract/
// read-page-tool.ts), and the errors a source plugin can surface into a
// source's health (info/sources/plugins/). The source every other locale is
// typed against.

export default {
  backToBriefing: "‹ Briefing",
  title: "Sources",
  addHint:
    "To add a source, tell the AI about it — say the site or feed you want followed and it checks the source works before it goes on this list.",
  signedInSites: "Signed-in sites",
  collectorSignedIn: "Signed in on {device}",
  collectorNeedsSignIn: "Needs signing in on {device} for the full text",
  signInNote:
    "Signing in opens the site's own page in a window. Close it when you are done — your password never reaches this app, and only the site's cookie stays behind.",
  empty: "No sources yet.",
  healthAriaLabel: "Source health",
  lastSuccess: "Last success: {time}",
  noSuccessYet: "No successful run yet.",
  errorLine: "{time}: {error}",
  checkTitle: "Load the site in the background and see whether it still asks you to sign in",
  check: "Check",
  signOut: "Sign out",
  signIn: "Sign in",
  enableAriaLabel: "Enable {name}",
  remove: "Remove",
  removeAriaLabel: "Remove source",
  removeConfirmTitle: "Remove “{name}”?",
  removeConfirmDescription: "Nothing more is collected from it. To follow it again, tell the AI about it.",

  "time.secondsAgo": { one: "{count} second ago", other: "{count} seconds ago" },
  "time.minutesAgo": { one: "{count} minute ago", other: "{count} minutes ago" },
  "time.hoursAgo": { one: "{count} hour ago", other: "{count} hours ago" },
  "time.daysAgo": { one: "{count} day ago", other: "{count} days ago" },

  "session.notChecked": "Not checked",
  "session.couldNotTell": "Could not tell",
  "session.signedIn": "Signed in",
  "session.notSignedIn": "Not signed in",
  "session.workSigningIn": "Finish in the sign-in window, then close it",
  "session.workConfirming": "Confirming your sign-in…",
  "session.workChecking": "Checking the site…",
  "session.workSigningOut": "Signing out…",
  "session.sourcesCount": { one: "{count} source", other: "{count} sources" },

  "pipe.apiFullArticles": "API with full articles",
  "pipe.apiHeadlinesOnly": "API, headlines only",
  "pipe.articleList": "Article list, fetches each page",
  "pipe.liveUpdates": "Live updates",
  "pipe.indexQuery": "Index query ({provider})",
  "pipe.fullTextInFeed": "Full text in feed",
  "pipe.fullTextInFeedPaywalled": "Full text in feed (some paywalled)",
  "pipe.feedFetchesPage": "Feed headlines, fetches each page",
  "pipe.feedOpensWindow": "Feed headlines, opens each article in a browser window",
  "pipe.headlinesOnlyBrowser": "Headlines only, opens in browser",

  "tool.theSite": "the site",
  "tool.probingSite": "Probing {input}",
  "tool.fetchingWebviewArticles": {
    one: "Fetching {count} article through a background browser window — tens of seconds",
    other: "Fetching {count} articles through a background browser window — tens of seconds",
  },
  "tool.fetchingArticles": {
    one: "Fetching {count} article to test",
    other: "Fetching {count} articles to test",
  },
  "tool.addingSource": "Adding the source",
  "tool.trialReceiptLabel": "Trialled a source",
  "tool.trialReceiptSummary": "{name} ({pipe})",
  "tool.addReceiptLabel": "Added a source",

  "tasking.label": "Looking into it",
  "tasking.searchingCablesFor": "Searching the cables for “{query}”",
  "tasking.searchingCables": "Searching the cables",
  "tasking.readingCable": "Reading a cable",
  "tasking.readingPictureFor": "Reading the picture for {lab}",
  "tasking.readingPicture": "Reading the situation picture",

  "readPage.thePage": "the page",
  "readPage.reading": "Reading {url}",

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
} as const;
