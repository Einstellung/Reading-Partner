// The info home screens (docs/16, docs/17): the vestibule, today's briefing, an
// opened article, the source list, and the info companion chat over them. Owns
// the briefing pipeline subscription and everything the briefing reads or
// writes; App keeps only which screen is showing, since the header and the
// library branch on it too.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadSettings } from "../../../platform/app/settings";
import { buildGlossary } from "../../../ai/voice";
import { getInfoPipeline } from "../../../info/briefing/live";
import type { InfoPipeline, InfoSnapshot } from "../../../info/briefing/pipeline";
import { loadArticle, loadItems, todayLocal } from "../../../info/briefing/store";
import type { BriefingItemMeta } from "../../../info/briefing/types";
import { ensureBriefTopic } from "../../../platform/app/topics";
import {
  loadSavedArticles,
  saveArticle,
  savedArticleId,
} from "../../../reading/saved-articles";
import { toSavedArticleInput } from "./saveArticle";
import { appendFeedback } from "../../../observation/feedback";
import { loadProfile } from "../../../observation/profile";
import { sanitizeArticleHtml } from "../../../info/extract/sanitize";
import {
  articleChatSystemPrompt,
  briefingChatSystemPrompt,
  noBriefingChatSystemPrompt,
} from "../../../info/companion/chat";
import { addSourceSystemPrompt } from "../../../info/sources/source-skill";
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
import { liveProbeAndTrial } from "../../../info/sources/source-live";
import type { SourceDescriptor } from "../../../info/sources/descriptor";
import type { SourceHealth } from "../../../info/sources/engine";
import {
  applySessionCheck,
  forgetSession,
  type SignInSite,
  type SiteSessions,
} from "../../../info/sources/site-session";
import {
  checkSiteSession,
  clearSiteCookies,
  openSiteSignIn,
} from "../../../info/extract/webview-session";
import { hasWebviewFetch } from "../../../platform/app/platform";
import { Vestibule } from "./Vestibule";
import { BriefingPage } from "./BriefingPage";
import { SourcesPage } from "./SourcesPage";
import { ArticleView } from "./ArticleView";
import { InfoCall, type InfoCallAnchor } from "./InfoCall";
// The phone shell's gesture, mounted from here because the call it opens is
// owned here (see the pullToAsk prop).
import { PullToAsk } from "../phone/PullToAsk";

// The launch layer in front of the library. "library" belongs to App, which
// renders the shelf; it is in the union so the two navigate through one setter.
export type HomeScreen = "vestibule" | "library" | "briefing" | "article" | "sources";

// Everything a launch screen needs from the briefing pipeline. The state lives
// here, so a shell that draws its own launch screen (the phone's, docs/22) is
// handed these rather than subscribing a second time.
export interface LaunchProps {
  snap: InfoSnapshot | null;
  configured: boolean;
  hasSources: boolean | null;
  onAsk: () => void;
  onStop: () => void;
  onOpenBriefing: () => void;
  onOpenSettings: () => void;
  onStartSubscribing: () => void;
}

export default function InfoHome(props: {
  // Which screen to show, or null while the reader is open (the pipeline
  // subscription lives on regardless, so a briefing keeps generating).
  screen: HomeScreen | null;
  onNavigate: (screen: HomeScreen) => void;
  // The launch screen to draw in place of the vestibule. Omitted by the desktop
  // shell, which wants the vestibule; the phone shell has no library and no
  // book to continue, so it draws its own.
  renderLaunch?: (launch: LaunchProps) => React.ReactNode;
  // The most recently opened book, for the vestibule's Continue reading.
  continueBook?: { title: string; topicName: string } | null;
  onContinue?: () => void;
  // Whether an AI provider is connected (the vestibule guides to Settings).
  configured: boolean;
  onOpenSettings: () => void;
  // Keeping an article can create the Brief topic, so the shelf needs a reload.
  onTopicsChanged: () => Promise<void> | void;
  // Called with a way to close the info call whenever one opens, and with null
  // when it closes. For a shell whose back is global (the phone's: a left-edge
  // swipe and the Android button, neither of which can aim at a close button) —
  // back has to close the call before it navigates, or hanging up leaves the
  // reader on a screen they never chose. Omitted by the desktop shell, where
  // back is the call's own Hang up.
  onOverlayChange?: (dismiss: (() => void) | null) => void;
  // Phone shell only (docs/22): a pull from the top of the briefing or of an
  // article opens the same chat their Ask buttons open. One more trigger for a
  // call this component already owns, on the same footing as onOverlayChange —
  // omitted by the desktop shell, which renders exactly what it did before.
  pullToAsk?: boolean;
  // Whether the call keeps its corner cards (docs/03). Default, and the desktop
  // shell: it does. The phone shell turns them off — there the chat is a screen
  // of the navigation stack with gestures in and out of it, and a card that
  // swaps it away would be a second way to leave, eating a corner of a 393pt
  // screen to offer it.
  pipCards?: boolean;
}) {
  const { screen, onNavigate } = props;
  const [infoSnap, setInfoSnap] = useState<InfoSnapshot | null>(null);
  // Whether the user has any source configured (drives onboarding), plus the
  // source list + health for the source-list page (docs/17).
  const [hasSourcesState, setHasSourcesState] = useState<boolean | null>(null);
  const [sourcesList, setSourcesList] = useState<SourceDescriptor[]>([]);
  const [sourceHealth, setSourceHealth] = useState<Record<string, SourceHealth>>({});
  // Last known sign-in state per site, and which site is being worked on. Both
  // only mean anything where there is a webview to sign in with.
  const [siteSessions, setSiteSessions] = useState<SiteSessions>({});
  const [sessionBusy, setSessionBusy] = useState<string | null>(null);
  const infoRef = useRef<InfoPipeline | null>(null);
  const [openArticleId, setOpenArticleId] = useState<string | null>(null);
  const [articleHtml, setArticleHtml] = useState<string | null>(null);
  const [openedItemIds, setOpenedItemIds] = useState<Set<string>>(new Set());
  const [dismissedItemIds, setDismissedItemIds] = useState<Set<string>>(new Set());
  const [infoCall, setInfoCall] = useState<InfoCallAnchor | null>(null);
  // Ids of articles already kept, so the article view can show its kept state.
  // Keyed by saved-article id (the normalized URL), not by briefing item id,
  // which is per-day.
  const [keptIds, setKeptIds] = useState<Set<string>>(new Set());

  // Attach the info-briefing pipeline (docs/16): mirror its snapshot for the
  // vestibule and load today's briefing if one exists.
  useEffect(() => {
    const p = getInfoPipeline();
    infoRef.current = p;
    setInfoSnap(p.snapshot());
    const unsub = p.subscribe(() => setInfoSnap(p.snapshot()));
    p.init().catch(() => {});
    hasSources().then(setHasSourcesState).catch(() => {});
    loadSavedArticles()
      .then((list) => setKeptIds(new Set(list.map((a) => a.id))))
      .catch(() => {});
    return unsub;
  }, []);

  // Report the open call upward, and take the report back on unmount. Nothing
  // else changes with it: the call is still owned and closed here.
  const { onOverlayChange } = props;
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

  const stopBriefing = useCallback(() => {
    infoRef.current?.stop();
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

  // A site's session, checked by loading its front page in the hidden window and
  // seeing whether it still offers a sign-in. Tens of seconds, so the row says
  // it is working; the answer is cached because the check is not free and the
  // reader wants to see where they stand on arrival, not after a wait.
  const checkSession = useCallback(async (site: SignInSite) => {
    setSessionBusy(site.host);
    try {
      const status = await checkSiteSession(site.checkUrl);
      const next = applySessionCheck(
        await loadSiteSessions(),
        site.host,
        status,
        Date.now(),
      );
      await saveSiteSessions(next);
      setSiteSessions(next);
    } catch (e) {
      console.warn("session check failed", e);
    } finally {
      setSessionBusy(null);
    }
  }, []);

  // Sign in: the site's own page, in a window the user types into. It resolves
  // when they close the window, and the state is checked right after — closing
  // says the flow is over, not that it worked.
  const signInToSite = useCallback(
    async (site: SignInSite) => {
      setSessionBusy(site.host);
      try {
        await openSiteSignIn(site.signInUrl);
      } catch (e) {
        console.warn("sign-in window failed", e);
        setSessionBusy(null);
        return;
      }
      setSessionBusy(null);
      await checkSession(site);
    },
    [checkSession],
  );

  // Sign out: delete the site's cookies. Nothing else is held, so nothing else
  // has to be undone.
  const signOutOfSite = useCallback(async (site: SignInSite) => {
    setSessionBusy(site.host);
    try {
      await clearSiteCookies(site.host);
      const next = forgetSession(await loadSiteSessions(), site.host);
      await saveSiteSessions(next);
      setSiteSessions(next);
    } catch (e) {
      console.warn("sign-out failed", e);
    } finally {
      setSessionBusy(null);
    }
  }, []);

  // Open the first-run / add-source chat: the info call in add-source mode.
  const openOnboarding = useCallback(() => {
    void (async () => {
      const { aiLanguage } = await loadSettings();
      setInfoCall({
        threadId: "onboarding",
        mode: "add-source",
        onboarding: true,
        emptyTitle: "Let's set up your sources",
        placeholder: "Tell me what you follow, or paste a link…",
        systemPrompt: addSourceSystemPrompt({ aiLanguage, onboarding: true }),
        position: { title: "Subscriptions", line: "Set up your information sources" },
      });
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
      const briefing = infoRef.current?.snapshot().briefing ?? null;
      const date = briefing?.date ?? todayLocal();
      setOpenArticleId(itemId);
      setArticleHtml(null);
      onNavigate("article");
      const meta = briefing?.items[itemId];
      // Opening an article logs "opened" once per session; it also drives the
      // read-state marker on the briefing.
      if (meta && !openedItemIds.has(itemId)) {
        setOpenedItemIds((s) => new Set(s).add(itemId));
        appendFeedback({ itemId, title: meta.title, action: "opened" }).catch(() => {});
      }
      // The sanitized HTML keeps its external image URLs; ArticleView points
      // them at the img: proxy on its way into the DOM (docs/pitfall/30).
      try {
        const cached = await loadArticle(date, itemId);
        setArticleHtml(cached?.contentHtml ? sanitizeArticleHtml(cached.contentHtml) : null);
      } catch {
        setArticleHtml(null);
      }
    },
    [openedItemIds, onNavigate],
  );

  // Keep the open article: file it under the Brief topic with its body snapshot
  // (docs/21, store-and-display slice). The HTML kept is what the host holds,
  // whose images are still plain https URLs (the img: proxy is applied in the
  // view), and the plain text comes from the day's cache, which the AI reads.
  // The on-screen HTML has been through sanitizeArticleHtml; the day cache holds
  // what the site served, so the fallback has to be sanitized here. A saved
  // article is rendered with dangerouslySetInnerHTML, and it is rendered again
  // on every later open — storing raw remote HTML would persist the hole.
  const keepArticle = useCallback(
    async (itemId: string) => {
      const briefing = infoRef.current?.snapshot().briefing ?? null;
      const meta = briefing?.items[itemId];
      if (!meta) return;
      const date = briefing?.date ?? todayLocal();
      const [topic, cached, items] = await Promise.all([
        ensureBriefTopic(),
        loadArticle(date, itemId).catch(() => null),
        loadItems(date).catch(() => []),
      ]);
      const saved = await saveArticle(
        toSavedArticleInput({
          topicId: topic.id,
          meta,
          itemId,
          items,
          html:
            articleHtml ??
            (cached?.contentHtml ? sanitizeArticleHtml(cached.contentHtml) : null),
          text: cached?.textContent ?? null,
        }),
      );
      if (!saved) return;
      setKeptIds((s) => new Set(s).add(saved.id));
      await props.onTopicsChanged();
    },
    [articleHtml, props.onTopicsChanged],
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

  const askBriefing = useCallback(async () => {
    const b = infoRef.current?.snapshot().briefing;
    if (!b) return;
    const [profile, sources, settings] = await Promise.all([loadProfile(), loadSources(), loadSettings()]);
    setInfoCall({
      threadId: "briefing",
      emptyTitle: "Today's briefing",
      placeholder: "Ask about today's briefing…",
      systemPrompt: briefingChatSystemPrompt(b, {
        profile,
        sources,
        aiLanguage: settings.aiLanguage,
        canSignIn: hasWebviewFetch(),
      }),
      position: { title: "Today's briefing", line: b.overview },
    });
  }, []);

  // The launch card's way into the companion. With a briefing it is the same
  // thread the briefing page's Ask opens; without one — the day's collection has
  // not landed, or it failed — it is the same thread told so, which is where a
  // regenerate is asked for now that no button offers one (docs/35).
  const askLaunch = useCallback(async () => {
    const snap = infoRef.current?.snapshot();
    if (snap?.briefing) {
      await askBriefing();
      return;
    }
    const [profile, sources, settings] = await Promise.all([
      loadProfile(),
      loadSources(),
      loadSettings(),
    ]);
    setInfoCall({
      threadId: "briefing",
      emptyTitle: "Today's briefing",
      placeholder: "Ask about today's briefing…",
      systemPrompt: noBriefingChatSystemPrompt(
        { profile, sources, aiLanguage: settings.aiLanguage, canSignIn: hasWebviewFetch() },
        { error: snap?.error ?? undefined },
      ),
      position: {
        title: "Today's briefing",
        line: snap?.error ?? "Not collected yet",
      },
    });
  }, [askBriefing]);

  const askArticle = useCallback(async (itemId: string) => {
    const b = infoRef.current?.snapshot().briefing;
    if (!b) return;
    const meta = b.items[itemId];
    const [cached, profile, sources, settings] = await Promise.all([
      loadArticle(b.date, itemId),
      loadProfile(),
      loadSources(),
      loadSettings(),
    ]);
    // The item's one-line reason/overview from the briefing tiers, shown on the
    // position card so the chat window can recall what the article was about.
    const line =
      b.mustRead.find((r) => r.itemId === itemId)?.reason ??
      b.oneLiners.find((r) => r.itemId === itemId)?.line ??
      b.outOfLane.find((r) => r.itemId === itemId)?.reason ??
      null;
    setInfoCall({
      threadId: itemId,
      emptyTitle: meta?.title ?? "Article",
      placeholder: "Ask about this article…",
      systemPrompt: articleChatSystemPrompt(b.overview, meta?.title ?? "", cached?.textContent ?? "", {
        profile,
        sources,
        aiLanguage: settings.aiLanguage,
        canSignIn: hasWebviewFetch(),
      }),
      position: { title: meta?.title ?? "Article", sourceName: meta?.sourceName, line },
    });
  }, []);

  if (screen === null) return null;

  return (
    <>
      {screen === "vestibule" && (
        <div className="absolute inset-0 overflow-y-auto bg-white">
          {props.renderLaunch ? (
            props.renderLaunch({
              snap: infoSnap,
              configured: props.configured,
              hasSources: hasSourcesState,
              onAsk: () => void askLaunch(),
              onStop: stopBriefing,
              onOpenBriefing: () => onNavigate("briefing"),
              onOpenSettings: props.onOpenSettings,
              onStartSubscribing: openOnboarding,
            })
          ) : (
            <Vestibule
              continueBook={props.continueBook ?? null}
              snap={infoSnap}
              configured={props.configured}
              hasSources={hasSourcesState}
              onContinue={props.onContinue ?? (() => {})}
              onOpenLibrary={() => onNavigate("library")}
              onAsk={() => void askLaunch()}
              onStop={stopBriefing}
              onOpenBriefing={() => onNavigate("briefing")}
              onOpenSettings={props.onOpenSettings}
              onStartSubscribing={openOnboarding}
            />
          )}
        </div>
      )}

      {screen === "briefing" && infoSnap?.briefing && (() => {
        const page = (
          <div className="absolute inset-0 overflow-y-auto bg-white">
            <BriefingPage
              briefing={infoSnap.briefing}
              openedIds={openedItemIds}
              dismissedIds={dismissedItemIds}
              onOpenArticle={openArticle}
              onDismiss={dismissItem}
              onAppeal={appealItem}
              onAskBriefing={askBriefing}
              onAskArticle={askArticle}
              onOpenSources={openSourcesPage}
              onBack={() => onNavigate("vestibule")}
            />
          </div>
        );
        return props.pullToAsk ? (
          <PullToAsk label="Ask about today's briefing" onAsk={() => void askBriefing()}>
            {page}
          </PullToAsk>
        ) : (
          page
        );
      })()}

      {screen === "sources" && (
        <div className="absolute inset-0 overflow-y-auto bg-white">
          <SourcesPage
            sources={sourcesList}
            health={sourceHealth}
            sessions={siteSessions}
            sessionBusy={sessionBusy}
            {...(hasWebviewFetch()
              ? {
                  onSignIn: (site: SignInSite) => void signInToSite(site),
                  onCheckSession: (site: SignInSite) => void checkSession(site),
                  onSignOut: (site: SignInSite) => void signOutOfSite(site),
                }
              : {})}
            onToggle={toggleSource}
            onRemove={removeSourceById}
            onProbeAdd={liveProbeAndTrial}
            onConfirmAdd={confirmAddSource}
            onBack={() => onNavigate("briefing")}
          />
        </div>
      )}

      {screen === "article" && openArticleId && infoSnap?.briefing && (() => {
        const meta =
          infoSnap.briefing.items[openArticleId] ?? {
            title: "Article",
            url: "",
            source: "",
            sourceName: "",
            publishedAt: "",
          };
        const view = (
          <ArticleView
            meta={meta}
            contentHtml={articleHtml}
            saved={keptIds.has(savedArticleId(meta.url, meta.title))}
            onBack={() => onNavigate("briefing")}
            onAsk={() => askArticle(openArticleId)}
            onSave={() => void keepArticle(openArticleId)}
          />
        );
        // The article view's own root is the scroll container, so it is the
        // child the pull host wraps directly; the plain wrapper is what the
        // desktop shell has always drawn around it.
        return props.pullToAsk ? (
          <PullToAsk label="Ask about this article" onAsk={() => void askArticle(openArticleId)}>
            {view}
          </PullToAsk>
        ) : (
          <div className="absolute inset-0">{view}</div>
        );
      })()}

      {infoCall && (
        <InfoCall
          anchor={infoCall}
          dateKey={infoSnap?.briefing?.date ?? todayLocal()}
          onHangUp={() => setInfoCall(null)}
          voice={infoVoice}
          onSourcesChanged={refreshSources}
          onOpenBriefing={() => onNavigate("briefing")}
          pipCards={props.pipCards}
        />
      )}
    </>
  );
}
