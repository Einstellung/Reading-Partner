// The info home screens (docs/16, docs/17): the vestibule, today's briefing, an
// opened article, the source list, and the info companion chat over them. Owns
// the briefing pipeline subscription and everything the briefing reads or
// writes; App keeps only which screen is showing, since the header and the
// library branch on it too.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadSettings } from "../../platform/app/settings";
import { buildGlossary } from "../../voice";
import { getInfoPipeline } from "../../info/briefing/live";
import type { InfoPipeline, InfoSnapshot } from "../../info/briefing/pipeline";
import { loadArticle, saveInlinedArticleHtml, todayLocal } from "../../info/briefing/store";
import type { BriefingItemMeta } from "../../info/briefing/types";
import { appendFeedback } from "../../memory/feedback";
import { loadProfile } from "../../memory/profile";
import { sanitizeArticleHtml } from "../../info/extract/sanitize";
import { extractImageSrcs, inlineArticleImages } from "../../info/extract/inline-images";
import { fetchImageBytes } from "../../info/extract/http";
import { articleChatSystemPrompt, briefingChatSystemPrompt } from "../../info/companion/chat";
import { addSourceSystemPrompt } from "../../info/sources/source-skill";
import {
  addSource as addSourceStore,
  hasSources,
  loadSources,
  loadSourceHealth,
  removeSource,
  setSourceEnabled,
} from "../../info/sources/source-store";
import { liveProbeAndTrial } from "../../info/sources/source-live";
import type { SourceDescriptor } from "../../info/sources/descriptor";
import type { SourceHealth } from "../../info/sources/engine";
import { Vestibule } from "./Vestibule";
import { BriefingPage } from "./BriefingPage";
import { SourcesPage } from "./SourcesPage";
import { ArticleView } from "./ArticleView";
import { InfoCall, type InfoCallAnchor } from "./InfoCall";

// The launch layer in front of the library. "library" belongs to App, which
// renders the shelf; it is in the union so the two navigate through one setter.
export type HomeScreen = "vestibule" | "library" | "briefing" | "article" | "sources";

export default function InfoHome(props: {
  // Which screen to show, or null while the reader is open (the pipeline
  // subscription lives on regardless, so a briefing keeps generating).
  screen: HomeScreen | null;
  onNavigate: (screen: HomeScreen) => void;
  // The most recently opened book, for the vestibule's Continue reading.
  continueBook: { title: string; topicName: string } | null;
  onContinue: () => void;
  // Whether an AI provider is connected (the vestibule guides to Settings).
  configured: boolean;
  onOpenSettings: () => void;
}) {
  const { screen, onNavigate } = props;
  const [infoSnap, setInfoSnap] = useState<InfoSnapshot | null>(null);
  // Whether the user has any source configured (drives onboarding), plus the
  // source list + health for the source-list page (docs/17).
  const [hasSourcesState, setHasSourcesState] = useState<boolean | null>(null);
  const [sourcesList, setSourcesList] = useState<SourceDescriptor[]>([]);
  const [sourceHealth, setSourceHealth] = useState<Record<string, SourceHealth>>({});
  const infoRef = useRef<InfoPipeline | null>(null);
  const [openArticleId, setOpenArticleId] = useState<string | null>(null);
  const [articleHtml, setArticleHtml] = useState<string | null>(null);
  // Aborts the previous article's background image-inlining when another opens.
  const articleInlineAbort = useRef<AbortController | null>(null);
  const [openedItemIds, setOpenedItemIds] = useState<Set<string>>(new Set());
  const [dismissedItemIds, setDismissedItemIds] = useState<Set<string>>(new Set());
  const [infoCall, setInfoCall] = useState<InfoCallAnchor | null>(null);

  // Attach the info-briefing pipeline (docs/16): mirror its snapshot for the
  // vestibule and load today's briefing if one exists.
  useEffect(() => {
    const p = getInfoPipeline();
    infoRef.current = p;
    setInfoSnap(p.snapshot());
    const unsub = p.subscribe(() => setInfoSnap(p.snapshot()));
    p.init().catch(() => {});
    hasSources().then(setHasSourcesState).catch(() => {});
    return unsub;
  }, []);

  // The glossary anchors the STT cleanup pass on the article/briefing title
  // (there is no book outline here).
  const infoVoice = useMemo(
    () => ({ glossary: buildGlossary({ title: infoCall?.position.title }) }),
    [infoCall],
  );

  const generateBriefing = useCallback(() => {
    void infoRef.current?.generate();
  }, []);
  const stopBriefing = useCallback(() => {
    infoRef.current?.stop();
  }, []);

  // Reload the source list + health (source-list page) and the hasSources flag.
  const refreshSources = useCallback(async () => {
    const [list, health] = await Promise.all([loadSources(), loadSourceHealth()]);
    setSourcesList(list);
    setSourceHealth(health);
    setHasSourcesState(list.length > 0);
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
      // Stop the previously opened article's image-inlining before starting this one.
      articleInlineAbort.current?.abort();
      const ac = new AbortController();
      articleInlineAbort.current = ac;
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
      let sanitized: string | null = null;
      try {
        const cached = await loadArticle(date, itemId);
        sanitized = cached?.contentHtml ? sanitizeArticleHtml(cached.contentHtml) : null;
        setArticleHtml(sanitized);
      } catch {
        setArticleHtml(null);
      }
      // External <img> loads are blocked by the webview's CSP/COEP (docs/pitfall/30):
      // fetch each through the Tauri http route, swap in data: URLs as they arrive,
      // then persist the rewritten HTML so later opens are instant and offline.
      if (ac.signal.aborted || !sanitized || extractImageSrcs(sanitized).length === 0) return;
      try {
        const inlined = await inlineArticleImages(sanitized, fetchImageBytes, {
          signal: ac.signal,
          onProgress: (html) => {
            if (!ac.signal.aborted) setArticleHtml(html);
          },
        });
        if (ac.signal.aborted) return;
        setArticleHtml(inlined);
        await saveInlinedArticleHtml(date, itemId, inlined);
      } catch {
        // Leave the text-only render in place; a later open retries the images.
      }
    },
    [openedItemIds, onNavigate],
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
      }),
      position: { title: "Today's briefing", line: b.overview },
    });
  }, []);

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
      }),
      position: { title: meta?.title ?? "Article", sourceName: meta?.sourceName, line },
    });
  }, []);

  if (screen === null) return null;

  return (
    <>
      {screen === "vestibule" && (
        <div className="absolute inset-0 overflow-y-auto bg-white">
          <Vestibule
            continueBook={props.continueBook}
            snap={infoSnap}
            configured={props.configured}
            hasSources={hasSourcesState}
            onContinue={props.onContinue}
            onOpenLibrary={() => onNavigate("library")}
            onGenerate={generateBriefing}
            onStop={stopBriefing}
            onOpenBriefing={() => onNavigate("briefing")}
            onOpenSettings={props.onOpenSettings}
            onStartSubscribing={openOnboarding}
          />
        </div>
      )}

      {screen === "briefing" && infoSnap?.briefing && (
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
      )}

      {screen === "sources" && (
        <div className="absolute inset-0 overflow-y-auto bg-white">
          <SourcesPage
            sources={sourcesList}
            health={sourceHealth}
            onToggle={toggleSource}
            onRemove={removeSourceById}
            onProbeAdd={liveProbeAndTrial}
            onConfirmAdd={confirmAddSource}
            onBack={() => onNavigate("briefing")}
          />
        </div>
      )}

      {screen === "article" && openArticleId && infoSnap?.briefing && (
        <div className="absolute inset-0">
          <ArticleView
            meta={
              infoSnap.briefing.items[openArticleId] ?? {
                title: "Article",
                url: "",
                source: "",
                sourceName: "",
                publishedAt: "",
              }
            }
            contentHtml={articleHtml}
            onBack={() => onNavigate("briefing")}
            onAsk={() => askArticle(openArticleId)}
          />
        </div>
      )}

      {infoCall && (
        <InfoCall
          anchor={infoCall}
          dateKey={infoSnap?.briefing?.date ?? todayLocal()}
          onHangUp={() => setInfoCall(null)}
          voice={infoVoice}
          onSourcesChanged={refreshSources}
          onOpenBriefing={() => onNavigate("briefing")}
        />
      )}
    </>
  );
}
