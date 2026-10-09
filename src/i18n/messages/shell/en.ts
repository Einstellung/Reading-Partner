// Shell: App.tsx and PhoneApp.tsx, the sidebar and header controls around
// them (ui/components/common, ui/components/base), the Lumen corner and its
// box of cards (ui/components/lumen, voice text excepted), the figure cards
// in a reply (ui/components/markdown), and the sentences a few platform
// modules hand up to be shown as a toast (platform/sync/health.ts,
// platform/sync/auth.ts, ai/image-utils.ts). The source every other locale is
// typed against.

export default {
  // Toasts App.tsx and PhoneApp.tsx push when a file, a saved conversation or
  // a side conversation cannot be reached.
  "toast.cantOpenDownloading": "Can't open this — it may not have finished downloading.",
  "toast.cantOpenFile": "Can't open this file — it may have been moved or deleted.",
  "toast.cantReadFile": "Can't read this file — it may have been moved or deleted.",
  "toast.asideGone": "That side conversation is gone.",
  "toast.conversationsUnloadable": "Saved AI conversations could not be loaded",
  "toast.cantShareFile": "This file could not be handed to another app.",

  // The book-level call: its empty-state title and placeholder, and the
  // unconfigured-provider card.
  "call.askAboutThisTitle": "Ask about this",
  "call.askAboutThisPlaceholder": "Ask about this…",
  "call.teachPlaceholder": "Ask me to teach you part of this book…",
  "call.thisBookFallback": "This book",
  "call.configurePrompt": "Configure a provider in Settings to start chatting.",
  "call.openSettings": "Open Settings",
  "call.retry": "Retry",

  // Reused across several small controls.
  "action.dismiss": "Dismiss",
  "action.cancel": "Cancel",
  "action.delete": "Delete",

  // The phone's saved-article screen, opened from the vestibule.
  "savedArticle.backLabel": "Saved",

  // AppSidebar / SettingsButton.
  "nav.settings": "Settings",
  "nav.settingsNeedsAttention": "Settings — sync needs attention",
  "sidebar.sections": "Sections",
  "sidebar.expand": "Expand sidebar",
  "sidebar.collapse": "Collapse sidebar",
  "sidebar.updating": "Updating…",
  "sidebar.restartToUpdate": "Restart to update",

  // Lumen, the corner companion, and the case she carries the box in.
  "lumen.show": "Show Lumen",
  "lumen.hide": "Hide Lumen",
  "lumen.needsDecision": "Needs a decision",
  "lumen.holdForMenu": "Hold for Lumen's menu",
  "lumen.menuVoice": "Voice",
  "lumen.menuType": "Type",

  // Typing to Lumen: the day's conversation at the door (lumen/DoorChat.tsx).
  "door.title": "Lumen",
  "door.close": "Close",
  "door.empty": "What's on your mind?",
  "door.placeholder": "Message Lumen…",
  "door.failed": "Couldn't start this reply.",

  // The box's cards: where each item came from, and the case's own label.
  "box.bookFallback": "A book",
  "box.originBookPage": "{book} · p. {page}",
  "box.originDoor": "At the door · {date}",
  "box.originBriefing": "Briefing · {date}",
  "box.originMeals": "Meals",
  "box.label": "The box",
  "box.waiting": { one: "The box, {count} waiting", other: "The box, {count} waiting" },
  "box.empty": "Nothing in the box.",
  "box.notReadable": "This one is in a book. Open it on the iPad or the desk.",

  // A figure cited in a reply: the card, its chip fallback and its dialog.
  "figure.label": "Fig. {id} · p.{page}",
  "figure.number": "Fig. {id}",
  "figure.pageSuffix": "· p.{page}",
  "figure.notFound": "No figure {id} in this document.",
  "figure.loading": "Loading figure…",
  "figure.notRendered": "This figure could not be rendered.",
  "figure.rendering": "Rendering the figure…",

  // A desktop on an older build than this phone or iPad (peer-update.ts).
  "peer.desktopMac": "Mac",
  "peer.desktopWindows": "Windows PC",
  "peer.desktopLinux": "Linux computer",
  "peer.desktopFallback": "computer",
  "peer.notice": "Your {name} is on {version}. Open Reading Partner there to update to {target}.",

  // What the app says about sync (platform/sync/health.ts), shown as a dot
  // and, for an alert, one toast per app start.
  "sync.credentialsMissing":
    "Auto-sync is on but this device is signed out of Google — nothing is syncing.",
  "sync.engineStopped": "Auto-sync is on but the sync engine is not running.",
  "sync.neverSynced": "This device has never completed a sync.",
  "sync.neverSyncedWithError": "This device has never completed a sync. Last error: {error}",
  "sync.stalled": "No sync has succeeded for over a day.",
  "sync.stalledWithError": "No sync has succeeded for over a day. Last error: {error}",
  "sync.lastFailed": "Last sync failed: {error}",

  // Google Drive sign-in (platform/sync/auth.ts): thrown, caught by
  // SyncCard and shown as its error line.
  "auth.notConfigured": "Google client not configured",
  "auth.tokenRequestFailed": "Google token request failed (HTTP {status}): {text}",
  "auth.redirectCaptureFailed": "Google sign-in could not capture the redirect: {error}",
  "auth.signInTimedOut": "Google sign-in timed out waiting for the redirect",
  "auth.authorizationError": "Google authorization error: {error}",
  "auth.noRefreshToken":
    "Google did not return a refresh token; try removing the app under myaccount.google.com and signing in again.",

  // A pasted or dropped image (ai/image-utils.ts), shown as the chat's image
  // hint on failure.
  "image.noCanvasContext": "Could not process the image (no canvas context).",
  "image.tooLarge": "Image is too large after compression ({mb} MB, max 5 MB).",
  "image.decodeFailed": "Could not decode the image.",

  // The sidebar's items (base/shell-nav.ts).
  "nav.today": "Today",
  "nav.briefing": "Briefing",
  "nav.meals": "Meals",
  "nav.topics": "Topics",

  "intake.question": "Which topic should this go in?",
  "intake.pickedWaiting": "Going into “{topic}” once it's read",
  "intake.suggested": "Suggested",
  "intake.newTopic": "New topic",
  "intake.newTopicPlaceholder": "New topic name",
  "intake.create": "Add",
  "intake.reading": "Reading {host}…",
  "intake.readingAny": "Reading…",
  "intake.readyOne": "Done: {title}. Pick a topic to file it.",
  "intake.ready": "Done. Pick a topic to file it.",
  "intake.filedInto": "Filed in “{topic}”",
  "intake.sections": { one: "{count} section", other: "{count} sections" },
  "intake.pages": { one: "{count} page", other: "{count} pages" },
  "intake.skipped": "Not taken: {reason}",
  "intake.skippedAt": "Not taken: {reason} ({address})",
  "intake.open": "Open",
  "intake.failedLabel": "Not taken",
  "intake.elsewhere": "This link was taken in on another device. Pick its topic there.",
  "intake.topicFallback": "this topic",
  "intake.reason.noContent": "it has no text of its own",
  "intake.reason.notChosen": "not related enough, so it was skipped",
  "intake.reason.onlyOnPage": "the full text is only on the post's page, which this device can't read",
  "intake.reason.shortLink": "the short link didn't open",
  "intake.reason.unreadable": "the page couldn't be read",
  "intake.reason.nothingFiled": "it was read, but nothing in it could be filed",
  "intake.reason.unknown": "no reason given",
} as const;
