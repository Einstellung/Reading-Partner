// The state behind the info home screens (docs/16, docs/17): the briefing view
// and its snapshot, the source list and its sign-in sessions, which article is
// open and what can be shown for it, what has been opened / dismissed / kept,
// and which conversation is up.
//
// It sits in the ui layer because it holds React state and drives effects. The
// decidable parts are one layer down and tested there: the anchors an Ask
// assembles (info/companion/anchors.ts) and the site-session sequencing
// (info/sources/session-flow.ts). The one sequence that cannot go down is
// keeping an article — it maps info's shapes onto reading's, and ui is the only
// layer allowed to touch both (saveArticle.ts) — so it is a plain exported
// function over ports rather than a closure inside the hook.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadSettings } from "../../../platform/app/settings";
import type { DeviceRole } from "../../../platform/app/device";
import { buildGlossary } from "../../../ai/voice";
import { getInfoView } from "../../../info/briefing/live";
import { todayLocal } from "../../../info/briefing/store";
import type { InfoSnapshot } from "../../../info/briefing/pipeline";
import {
  clearCollectorLeftovers,
  READER_PULL_ROUTE,
  type ArticleState,
  type BriefingView,
} from "../../../info/briefing/reader";
import { registerPullRoute } from "../../../platform/sync/pull-routes";
import type { BriefingItemMeta } from "../../../info/briefing/types";
import { ensureBriefTopic } from "../../../platform/app/topics";
import {
  loadSavedArticles,
  saveArticle,
  type SavedArticle,
  type SavedArticleInput,
} from "../../../reading/saved-articles";
import { toSavedArticleInput } from "./saveArticle";
import { appendFeedback } from "../../../memory/profile/feedback";
import { loadProfile } from "../../../memory/profile/profile";
import {
  articleAnchor,
  briefingAnchor,
  noBriefingAnchor,
  onboardingAnchor,
  type InfoCallAnchor,
} from "../../../info/companion/anchors";
import {
  addSource as addSourceStore,
  hasSources,
  loadSources,
  loadSourceHealth,
  loadSiteSessions,
  removeSource,
  saveSiteSessions,
  setSourceEnabled,
} from "../../../info/sources/source-store";
import type { SourceDescriptor } from "../../../info/sources/descriptor";
import type { SourceHealth } from "../../../info/sources/engine";
import {
  runSessionCheck,
  runSignIn,
  runSignOut,
  type SessionFlowPorts,
} from "../../../info/sources/session-flow";
import type {
  SessionBusy,
  SessionWork,
  SignInSite,
  SiteSessions,
} from "../../../info/sources/site-session";
import {
  checkSiteSession,
  clearSiteCookies,
  openSiteSignIn,
} from "../../../info/extract/webview-session";
import { hasWebviewFetch } from "../../../platform/app/platform";
import type { CollectorSites } from "../../../info/briefing/reader";
import type { ComposerVoice } from "../chat/chat";
import type { HomeScreen } from "./InfoHome";

export interface KeepArticlePorts {
  // Read the item's body when the screen has not already got it.
  article(itemId: string): Promise<ArticleState | undefined>;
  ensureTopic(): Promise<{ id: string }>;
  save(input: SavedArticleInput): Promise<SavedArticle | null>;
}

/**
 * Keep the open article: file it under the Brief topic with its body snapshot
 * (docs/21, store-and-display slice). The body is whatever the briefing view
 * answered with — the day's cache on a collector, the published bodies on a
 * reader — already sanitized, and with its external image URLs intact (the img:
 * proxy is applied in the view). A saved article is rendered with
 * dangerouslySetInnerHTML and rendered again on every later open, so raw remote
 * HTML must never reach the store.
 *
 * Only an item with a body can be kept (docs/36). Keeping one without would
 * write an empty snapshot over the full-text record the collector saved under
 * the same id, so every other ArticleState — pending, filtered, summaryOnly,
 * unknown — refuses rather than saving what it has.
 *
 * Answers with the saved article's id, or null when nothing was written.
 */
export async function keepBriefingArticle(
  itemId: string,
  meta: BriefingItemMeta | undefined,
  shown: ArticleState | null,
  ports: KeepArticlePorts,
): Promise<string | null> {
  if (!meta) return null;
  const state = shown ?? (await ports.article(itemId));
  if (!state || state.kind !== "body") return null;
  const topic = await ports.ensureTopic();
  const saved = await ports.save(toSavedArticleInput({ topicId: topic.id, meta, body: state.body }));
  return saved ? saved.id : null;
}

export interface InfoHomeOptions {
  // What this device is for (docs/36), null until device.json has been read.
  role: DeviceRole | null;
  onNavigate: (screen: HomeScreen) => void;
  // Keeping an article can create the Brief topic, so the shelf needs a reload.
  onTopicsChanged: () => Promise<void> | void;
  // Called with a way to close the info call whenever one opens, and with null
  // when it closes.
  onOverlayChange?: (dismiss: (() => void) | null) => void;
}

export interface InfoHomeController {
  // The briefing view, or null until the device role has landed.
  view: BriefingView | null;
  snap: InfoSnapshot | null;
  collecting: boolean;
  canSignIn: boolean;
  notices: string[];
  collectorSites: CollectorSites | null;
  // Sources page state.
  hasSources: boolean | null;
  sources: SourceDescriptor[];
  sourceHealth: Record<string, SourceHealth>;
  siteSessions: SiteSessions;
  sessionBusy: SessionBusy | null;
  // The open article and what can be shown for it.
  openArticleId: string | null;
  articleState: ArticleState | null;
  openedItemIds: Set<string>;
  dismissedItemIds: Set<string>;
  keptIds: Set<string>;
  // The conversation that is up, and how to end it.
  infoCall: InfoCallAnchor | null;
  closeCall: () => void;
  infoVoice: ComposerVoice;
  stopBriefing: () => void;
  refreshSources: () => Promise<void>;
  checkSession: (site: SignInSite, work?: SessionWork) => Promise<void>;
  signInToSite: (site: SignInSite) => Promise<void>;
  signOutOfSite: (site: SignInSite) => Promise<void>;
  openOnboarding: () => void;
  openSourcesPage: () => void;
  toggleSource: (id: string, enabled: boolean) => void;
  removeSourceById: (id: string) => void;
  confirmAddSource: (descriptor: SourceDescriptor) => Promise<void>;
  openArticle: (itemId: string) => Promise<void>;
  keepArticle: (itemId: string) => Promise<void>;
  dismissItem: (itemId: string, meta: BriefingItemMeta, category?: string) => void;
  appealItem: (itemId: string, meta: BriefingItemMeta, category: string) => void;
  askBriefing: () => Promise<void>;
  askLaunch: () => Promise<void>;
  askArticle: (itemId: string) => Promise<void>;
}

export function useInfoHome(opts: InfoHomeOptions): InfoHomeController {
  const { role, onNavigate, onTopicsChanged, onOverlayChange } = opts;
  const [infoSnap, setInfoSnap] = useState<InfoSnapshot | null>(null);
  // Whether the user has any source configured (drives onboarding), plus the
  // source list + health for the source-list page (docs/17).
  const [hasSourcesState, setHasSourcesState] = useState<boolean | null>(null);
  const [sourcesList, setSourcesList] = useState<SourceDescriptor[]>([]);
  const [sourceHealth, setSourceHealth] = useState<Record<string, SourceHealth>>({});
  // Last known sign-in state per site, and which site is being worked on. Both
  // only mean anything where there is a webview to sign in with.
  const [siteSessions, setSiteSessions] = useState<SiteSessions>({});
  const [sessionBusy, setSessionBusy] = useState<SessionBusy | null>(null);
  const viewRef = useRef<BriefingView | null>(null);
  const [openArticleId, setOpenArticleId] = useState<string | null>(null);
  // What can be shown for the open article: its body, or why there is none
  // (docs/36). Null while it is being read.
  const [articleState, setArticleState] = useState<ArticleState | null>(null);
  const [openedItemIds, setOpenedItemIds] = useState<Set<string>>(new Set());
  const [dismissedItemIds, setDismissedItemIds] = useState<Set<string>>(new Set());
  const [infoCall, setInfoCall] = useState<InfoCallAnchor | null>(null);
  // Ids of articles already kept, so the article view can show its kept state.
  // Keyed by saved-article id (the normalized URL), not by briefing item id,
  // which is per-day.
  const [keptIds, setKeptIds] = useState<Set<string>>(new Set());

  // Attach the briefing view (docs/16, docs/36): on a collector that is the
  // pipeline, on a reader the published files. Same two calls either way —
  // mirror the snapshot, and bring it up to date.
  useEffect(() => {
    if (!role) return;
    const view = getInfoView(role);
    viewRef.current = view;
    setInfoSnap(view.snapshot());
    const unsub = view.subscribe(() => setInfoSnap(view.snapshot()));
    view.init().catch(() => {});
    return unsub;
  }, [role]);

  useEffect(() => {
    hasSources().then(setHasSourcesState).catch(() => {});
    loadSavedArticles()
      .then((list) => setKeptIds(new Set(list.map((a) => a.id))))
      .catch(() => {});
  }, []);

  // A reader's briefing arrives over sync, so a pull is its "something changed"
  // (docs/36). A collector's comes out of its own pipeline and needs no such
  // listener — its own writes are what published these files.
  useEffect(() => {
    if (role !== "reader") return;
    return registerPullRoute({
      ...READER_PULL_ROUTE,
      onPulled: () => void viewRef.current?.init(),
    });
  }, [role]);

  // A device that ran an older build collected here, and those files are dead
  // weight now: one day's article cache measured 4.4 MB. Nothing on a reader
  // prunes them any more, because nothing on a reader constructs the pipeline
  // or the collector that used to (docs/36).
  useEffect(() => {
    if (role !== "reader") return;
    void clearCollectorLeftovers();
  }, [role]);

  const collecting = role === "collector";
  // Signing in needs both: a webview to open the window with, and a reason —
  // this machine fetching article bodies. On a machine that does not collect,
  // the cookie would go into a jar nothing reads (docs/36), so the buttons, the
  // tool and the sentence about them all go together.
  const canSignIn = hasWebviewFetch() && collecting;
  // Recomputed with the snapshot: all of it comes from the same read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const notices = useMemo(() => viewRef.current?.notices() ?? [], [infoSnap]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const collectorSites = useMemo(() => viewRef.current?.collectorSites() ?? null, [infoSnap]);

  // Report the open call upward, and take the report back on unmount. Nothing
  // else changes with it: the call is still owned and closed here.
  useEffect(() => {
    if (!onOverlayChange) return;
    onOverlayChange(infoCall ? () => setInfoCall(null) : null);
    return () => onOverlayChange(null);
  }, [infoCall, onOverlayChange]);

  // The glossary anchors the STT cleanup pass on the article/briefing title
  // (there is no book outline here).
  const infoVoice = useMemo(
    () => ({ glossary: buildGlossary({ title: infoCall?.position.title }) }),
    [infoCall],
  );

  const closeCall = useCallback(() => setInfoCall(null), []);

  const stopBriefing = useCallback(() => {
    viewRef.current?.stop();
  }, []);

  // Reload the source list + health (source-list page) and the hasSources flag.
  const refreshSources = useCallback(async () => {
    const [list, health, sessions] = await Promise.all([
      loadSources(),
      loadSourceHealth(),
      loadSiteSessions(),
    ]);
    setSourcesList(list);
    setSourceHealth(health);
    setSiteSessions(sessions);
    setHasSourcesState(list.length > 0);
  }, []);

  // The live wiring behind the three session gestures; the order they happen in
  // is info/sources/session-flow.ts.
  const sessionPorts: SessionFlowPorts = useMemo(
    () => ({
      check: checkSiteSession,
      openSignIn: openSiteSignIn,
      clearCookies: clearSiteCookies,
      loadSessions: loadSiteSessions,
      saveSessions: saveSiteSessions,
      now: Date.now,
      setBusy: setSessionBusy,
      setSessions: setSiteSessions,
    }),
    [],
  );

  const checkSession = useCallback(
    (site: SignInSite, work: SessionWork = "checking") => runSessionCheck(sessionPorts, site, work),
    [sessionPorts],
  );
  const signInToSite = useCallback(
    (site: SignInSite) => runSignIn(sessionPorts, site),
    [sessionPorts],
  );
  const signOutOfSite = useCallback(
    (site: SignInSite) => runSignOut(sessionPorts, site),
    [sessionPorts],
  );

  // Open the first-run / add-source chat: the info call in add-source mode.
  const openOnboarding = useCallback(() => {
    void (async () => {
      const { aiLanguage } = await loadSettings();
      setInfoCall(onboardingAnchor(aiLanguage));
    })();
  }, []);

  const openSourcesPage = useCallback(() => {
    void refreshSources();
    onNavigate("sources");
  }, [refreshSources, onNavigate]);

  const toggleSource = useCallback(
    (id: string, enabled: boolean) => {
      void (async () => {
        await setSourceEnabled(id, enabled);
        await refreshSources();
      })();
    },
    [refreshSources],
  );

  const removeSourceById = useCallback(
    (id: string) => {
      void (async () => {
        await removeSource(id);
        await refreshSources();
      })();
    },
    [refreshSources],
  );

  const confirmAddSource = useCallback(
    async (descriptor: SourceDescriptor) => {
      await addSourceStore(descriptor);
      await refreshSources();
    },
    [refreshSources],
  );

  const openArticle = useCallback(
    async (itemId: string) => {
      const briefing = viewRef.current?.snapshot().briefing ?? null;
      setOpenArticleId(itemId);
      setArticleState(null);
      onNavigate("article");
      const meta = briefing?.items[itemId];
      // Opening an article logs "opened" once per session; it also drives the
      // read-state marker on the briefing.
      if (meta && !openedItemIds.has(itemId)) {
        setOpenedItemIds((s) => new Set(s).add(itemId));
        appendFeedback({ itemId, title: meta.title, action: "opened" }).catch(() => {});
      }
      // The view answers with the body or with why there is none (docs/36). Its
      // HTML is sanitized and keeps its external image URLs; ArticleView points
      // them at the img: proxy on its way into the DOM (docs/pitfall/30).
      try {
        setArticleState((await viewRef.current?.article(itemId)) ?? { kind: "unknown" });
      } catch {
        setArticleState({ kind: "unknown" });
      }
    },
    [openedItemIds, onNavigate],
  );

  const keepArticle = useCallback(
    async (itemId: string) => {
      const meta = viewRef.current?.snapshot().briefing?.items[itemId];
      const savedId = await keepBriefingArticle(itemId, meta, articleState, {
        article: (id) => Promise.resolve(viewRef.current?.article(id)),
        ensureTopic: ensureBriefTopic,
        save: saveArticle,
      });
      if (!savedId) return;
      setKeptIds((s) => new Set(s).add(savedId));
      await onTopicsChanged();
    },
    [articleState, onTopicsChanged],
  );

  const dismissItem = useCallback((itemId: string, meta: BriefingItemMeta, category?: string) => {
    setDismissedItemIds((s) => new Set(s).add(itemId));
    appendFeedback({ itemId, title: meta.title, action: "dismissed", category }).catch(() => {});
  }, []);

  const appealItem = useCallback(
    (itemId: string, meta: BriefingItemMeta, category: string) => {
      appendFeedback({ itemId, title: meta.title, action: "appealed", category }).catch(() => {});
      void openArticle(itemId);
    },
    [openArticle],
  );

  // What every anchor needs beside the briefing itself: who the reader is, what
  // they subscribe to, and what this device can do about it.
  const companionContext = useCallback(async () => {
    const [profile, sources, settings] = await Promise.all([
      loadProfile(),
      loadSources(),
      loadSettings(),
    ]);
    return { profile, sources, aiLanguage: settings.aiLanguage, canSignIn, collecting };
  }, [canSignIn, collecting]);

  const askBriefing = useCallback(async () => {
    const b = viewRef.current?.snapshot().briefing;
    if (!b) return;
    setInfoCall(briefingAnchor(b, await companionContext()));
  }, [companionContext]);

  // The launch card's way into the companion. With a briefing it is the same
  // thread the briefing page's Ask opens; without one — the day's collection has
  // not landed, or it failed — it is the same thread told so, which is where a
  // regenerate is asked for now that no button offers one (docs/35).
  const askLaunch = useCallback(async () => {
    const snap = viewRef.current?.snapshot();
    if (snap?.briefing) {
      await askBriefing();
      return;
    }
    setInfoCall(
      noBriefingAnchor(await companionContext(), {
        // The day the briefing would have been for. Same fallback InfoHome uses
        // for the call's bookId, so the thread and the book agree.
        dateKey: todayLocal(),
        error: snap?.error ?? null,
        notices,
      }),
    );
  }, [askBriefing, companionContext, notices]);

  // The article chat only exists where there is an article to talk about
  // (docs/36): with no body the prompt would carry a title and nothing else.
  const askArticle = useCallback(
    async (itemId: string) => {
      const b = viewRef.current?.snapshot().briefing;
      if (!b) return;
      const [state, ctx] = await Promise.all([
        viewRef.current!.article(itemId),
        companionContext(),
      ]);
      if (state.kind !== "body") return;
      setInfoCall(articleAnchor(b, itemId, state.body.text, ctx));
    },
    [companionContext],
  );

  return {
    view: viewRef.current,
    snap: infoSnap,
    collecting,
    canSignIn,
    notices,
    collectorSites,
    hasSources: hasSourcesState,
    sources: sourcesList,
    sourceHealth,
    siteSessions,
    sessionBusy,
    openArticleId,
    articleState,
    openedItemIds,
    dismissedItemIds,
    keptIds,
    infoCall,
    closeCall,
    infoVoice,
    stopBriefing,
    refreshSources,
    checkSession,
    signInToSite,
    signOutOfSite,
    openOnboarding,
    openSourcesPage,
    toggleSource,
    removeSourceById,
    confirmAddSource,
    openArticle,
    keepArticle,
    dismissItem,
    appealItem,
    askBriefing,
    askLaunch,
    askArticle,
  };
}
