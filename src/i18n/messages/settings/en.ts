// Settings: the dialog and page frame, and the three tabs under
// ui/components/settings. The source every other locale is typed against.

export default {
  title: "Settings",
  done: "Done",
  "tab.account": "Account",
  "tab.features": "Features",
  "tab.optional": "Optional",
  connected: "Connected",
  save: "Save",
  signOut: "Sign out",
  apiKey: "API key",

  "thinking.off": "Off",
  "thinking.low": "Low",
  "thinking.medium": "Medium",
  "thinking.high": "High",

  "account.providers": "Providers",
  "account.signInWith": "Sign in with {name}",
  "account.defaultConversation": "Default conversation",
  "account.connectFirst": "Connect a provider above to choose a default.",
  "account.provider": "Provider",
  "account.model": "Model",
  "account.select": "Select…",
  "account.contextHint":
    "The number beside each model is its context window. This app reads a whole book into it; on a smaller window a reply drops material to fit and says what it dropped.",
  "account.everydayModel": "Everyday model",
  "account.sameAsChat": "Same as chat",
  "account.everydayHint":
    "The routine work runs here instead of on the model above: meals, and the nightly briefing. It is work nobody is waiting for, so a cheaper model costs you nothing; which tasks belong to it is decided by the app, not here. It uses the provider above.",
  "account.briefing": "Briefing",
  "account.screening": "Screening",
  "account.analysis": "Analysis",
  "account.briefingHint":
    "The briefing is built overnight, from every source, whether or not you read it. Screening reads the day's headlines to decide which articles are worth fetching, so it is the stage to keep low; analysis reads the ones that got through.",
  "account.thinking": "Thinking",
  "account.chat": "Chat",
  "account.lessonPrep": "Lesson prep",
  "account.thinkingHint":
    "Adaptive models decide per question how much to actually think; higher = deeper but slower.",
  "account.sync": "Sync",

  "oauth.signInFailed": "Sign-in failed",
  "oauth.openFailed": "Could not open the sign-in page",
  "oauth.invalidCode": "Invalid code",
  "oauth.pasteHintDevice":
    "After signing in, copy the address bar (the localhost URL that fails to load) and paste it here.",
  "oauth.pasteHintCode": "Paste the code shown after you approve access.",
  "oauth.opening": "Opening the sign-in page…",
  "oauth.completeInBrowser": "Complete authorization in your browser…",
  "oauth.withCode": "Sign in with a code",
  "oauth.pastePlaceholder": "Paste sign-in code or URL",
  "oauth.submit": "Submit",
  "oauth.signsOutOthers": "Signing in here signs out other providers.",
  "oauth.requestingCode": "Requesting a sign-in code…",
  "oauth.openPage": "Open sign-in page",
  "oauth.enterCode": "Enter this code at {url}. Waiting for authorization…",
  "oauth.cancel": "Cancel",
  "oauth.pasteInstead": "Paste the sign-in URL instead",
  "oauth.tryAgain": "Try again",

  "key.replace": "Replace API key",
  "key.signsOutOthers": "Saving a key here signs out other providers.",

  "sync.drive": "Google Drive",
  "sync.never": "Never",
  "sync.justNow": "Just now",
  "sync.minutesAgo": { one: "{count} minute ago", other: "{count} minutes ago" },
  "sync.failed": "Sync action failed",
  "sync.notConfigured": "Google client not configured.",
  "sync.signIn": "Sign in with Google",
  "sync.signedOutNote":
    "Everything since the last sync is on this device only. Sign in again to resume; nothing local is lost.",
  "sync.pitch": "Sync reading progress, marks, and books to your own Google Drive.",
  "sync.completeInBrowser": "Complete sign-in in your browser…",
  "sync.lastSync": "Last sync: {time}",
  "sync.auto": "Sync automatically",
  "sync.running": "Syncing…",
  "sync.now": "Sync now",

  "features.general": "General",
  "features.language": "Language",
  "features.languageAuto": "Auto (system UI, AI matches you)",
  "features.languageHint":
    "The language of the app and of everything the AI writes: chat replies, notes, and the news briefing. Auto shows the app in your system language and lets the AI answer in the language you write in. Voice transcription always follows what you speak.",
  "features.paper": "Paper background",
  "features.paperHint":
    "Turns the white behind the whole app — chats, shelves, sidebars, this dialog, and the pages of a book — into an off-white paper colour. There is one shade and no darker step; this is not a dark mode. The choice stays on this device.",
  "features.reading": "Reading",
  "features.fingerDraw": "Draw with your finger",
  "features.fingerDrawHint":
    "Off, a finger only moves the page and a stylus does the marking, whatever tool is selected. Turn it on for a device with no stylus, where the finger has to be able to highlight and draw. The navigation lock in the reader still overrides both. Whether there is a stylus is a property of this device, so this setting stays on it.",
  "features.briefing": "Briefing",
  "features.collect": "Collect from your sources on this computer",
  "features.collectHint":
    "Each source is checked on its own schedule and what it published is kept until the day's briefing is built. Off, this machine stops collecting entirely and another collector, if you have one, takes over.",
  "features.thisComputer": "This computer",
  "features.role": "This machine is a",
  "features.roleCollector": "Collector — read the sources here",
  "features.roleReader": "Reader — read what another machine collected",
  "features.roleHint":
    "A collector reads your subscribed sites all day and publishes the briefing for your other devices; a reader shows what a collector published and never fetches from a site itself. Phones and tablets are always readers. If two machines collect, the one that has been running longest does the work.",
  "features.autostart": "Start Reading Partner when this computer starts",
  "features.autostartHint":
    "Off by default. Turn it on for the machine you want collecting your sources all day — together with the tray, it means the briefing is being built whether or not you opened the app. This setting belongs to this computer and is not carried to your other devices.",

  "optional.intro":
    "Keys for outside services, each of them optional. The two voice keys are kept with this device's credentials and never sync, so every device needs its own.",
  "optional.meals": "Meals",
  "optional.mealsHint":
    "Plan the week's breakfasts, lunches and dinners, keep the shopping list, say when you ate something else.",
  "optional.lessonPrep": "Lesson prep",
  "optional.s2Key": "Semantic Scholar API key",
  "optional.s2Placeholder": "Optional",
  "optional.s2Hint":
    "A free key from semanticscholar.org avoids the shared rate limits that make paper fetching stall.",
  "optional.voiceInput": "Voice input",
  "optional.voiceOutput": "Voice output",
  "optional.dictationLanguage": "Dictation language",
  "optional.dictationHint":
    "The language the iPhone listens for when you hold the bar and talk. Speech is transcribed on the phone and never uploaded. Speaking a language other than this one does not produce a rough transcript — it produces a confident wrong one, so set it to the language you actually speak.",
  "optional.speechKey": "Speech API key",
  "optional.speechKeyReplace": "Replace speech API key",
  "optional.speechHint":
    "A Xiaomi MiMo key, for the voice that reads answers aloud. Without one the app stays silent and everything else works as it does now.",
  "optional.sttKey": "STT API key",
  "optional.sttKeyReplace": "Replace STT API key",
  "optional.model": "Model",
  "optional.baseUrl": "Base URL",
  "optional.sttHint":
    "Hold the mic in the chat box to talk. SiliconFlow's SenseVoice tier is free and its API key works out of the box; any OpenAI-compatible transcription endpoint works too.",
  "features.showMarks": "Show marks in the phone reader",
  "features.showMarksHint": "Highlights and AI underlines are drawn on the page. Off, the page is clean: the marks are still in the book and in the Marks list, and saving a new one turns this back on. The same switch is in the reader's Display sheet, and it stays on this phone.",
} as const;
