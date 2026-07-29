// The phone shell (docs/22), beside App.tsx. Info only: today's briefing, the
// articles it produced, the ones kept out of it, the companion chat over any of
// them, and settings. No reader, no annotations, no notes — the phone never
// opens a book, so none of App's reading state exists here.
//
// The briefing pipeline, the article cache and the info call stay in InfoHome,
// which both shells mount; this file owns where the reader is — a navigation
// stack (nav-stack.ts) whose floor is home — plus the kept articles, settings
// and sync.
//
// Back has one definition, `goBack`, and every top bar button reaches it.

import { useCallback, useEffect, useState } from "react";
import { onCorruptFile } from "./platform/app/atomic-fs";
import { BRIEF_TOPIC_ID } from "./platform/app/topics";
import { initSync, onSyncPulled } from "./platform/sync";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  onSettingsSaveError,
  saveSettings,
  type Settings,
} from "./platform/app/settings";
import { enforceModelFloor, listProviders, type ProviderInfo } from "./ai/aiClient";
import {
  loadSavedArticles,
  savedArticlesForTopic,
  SAVED_ARTICLES_FILE,
  type SavedArticle,
} from "./reading/saved-articles";
import InfoHome, { type HomeScreen } from "./ui/components/info/InfoHome";
import PhoneHome from "./ui/components/phone/PhoneHome";
import SavedList from "./ui/components/phone/SavedList";
import {
  back,
  baseScreen,
  goTo,
  INITIAL_STACK,
  push,
  screen,
  top,
  type NavStack,
  type PhoneScreen,
} from "./ui/components/phone/nav-stack";
import SavedArticleView from "./ui/components/library/SavedArticleView";
import SettingsView from "./ui/components/SettingsView";
import Toast, { useToasts } from "./ui/components/common/Toast";
import { useSyncHealth } from "./ui/components/common/useSyncHealth";

// InfoHome's screen for a stack entry, or null on the ones it does not draw.
// Null keeps it mounted with its pipeline and its opened article intact, the
// same way App parks it while the reader is open.
function infoScreenFor(base: PhoneScreen): HomeScreen | null {
  switch (base.kind) {
    case "home":
      return "vestibule";
    case "briefing":
      return "briefing";
    case "article":
      return "article";
    case "sources":
      return "sources";
    default:
      return null;
  }
}

export default function PhoneApp() {
  const [stack, setStack] = useState<NavStack>(INITIAL_STACK);
  // The kept articles (docs/21). Fixed to the Brief topic: the phone has no
  // other place to file one from. The one being read is a stack entry.
  const [savedArticles, setSavedArticles] = useState<SavedArticle[]>([]);
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [providersInfo, setProvidersInfo] = useState<ProviderInfo[]>([]);
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  const base = baseScreen(stack);
  const showSettings = top(stack).kind === "settings";
  const goBack = useCallback(() => setStack((s) => back(s)), []);

  const refreshSavedArticles = useCallback(async () => {
    const all = await loadSavedArticles().catch((): SavedArticle[] => []);
    setSavedArticles(savedArticlesForTopic(all, BRIEF_TOPIC_ID));
  }, []);

  // Settings, and the failure paths that must not be silent: a data file that
  // cannot be read is set aside and said out loud, and a stored default model
  // below the context floor is corrected and said out loud too (see App).
  useEffect(() => {
    onCorruptFile(({ file, savedAs }) => {
      pushToast(
        "warn",
        savedAs
          ? `${file} was unreadable and has been set aside as ${savedAs}`
          : `${file} could not be read; it is left untouched and won't be overwritten`,
      );
    });
    loadSettings()
      .then((loaded) => {
        const { settings: next, notice } = enforceModelFloor(loaded);
        setSettings(next);
        if (notice) {
          saveSettings(next);
          pushToast("warn", notice);
        }
      })
      .catch(() => {});
    onSettingsSaveError((e) => {
      console.error("failed to persist settings", e);
      pushToast("warn", "Settings could not be saved");
    });
    void refreshSavedArticles();
  }, [refreshSavedArticles, pushToast]);

  // Refresh provider connection state on mount and whenever Settings closes.
  useEffect(() => {
    if (!showSettings) listProviders().then(setProvidersInfo).catch(() => {});
  }, [showSettings]);

  // Account sync (docs/13). The kept articles are what this shell mostly shows
  // and they arrive over sync, so a pulled saved-articles.json reloads the list.
  useEffect(() => {
    // "phone": the books channel stays off here, since nothing on this shell
    // can open a PDF (docs/22).
    void initSync("phone").catch((e) => console.warn("sync init failed", e));
    return onSyncPulled((paths) => {
      if (paths.includes(SAVED_ARTICLES_FILE)) void refreshSavedArticles();
    });
  }, [refreshSavedArticles]);

  // A sync that is not running says so once, then keeps a dot on the Settings
  // affordance (see App: one toast, never repeated).
  const syncReport = useSyncHealth();
  const [syncToasted, setSyncToasted] = useState(false);
  useEffect(() => {
    if (syncReport.alert !== "alert" || !syncReport.message || syncToasted) return;
    setSyncToasted(true);
    pushToast("warn", syncReport.message);
  }, [syncReport, syncToasted, pushToast]);

  const configured = !!(
    settings.defaultProviderId &&
    settings.defaultModelId &&
    providersInfo.find((p) => p.id === settings.defaultProviderId)?.configured
  );

  // InfoHome navigates by naming a destination, and uses the same call for its
  // own top bar backs ("briefing" from an article). goTo unwinds to a screen
  // already on the stack, so those stay backs instead of stacking a second copy.
  // "library" cannot arrive: the phone home screen has no way there.
  const onNavigate = useCallback((next: HomeScreen) => {
    const kind = next === "vestibule" || next === "library" ? "home" : next;
    setStack((s) => goTo(s, screen(kind)));
  }, []);

  const openSettings = useCallback(() => setStack((s) => push(s, screen("settings"))), []);

  return (
    // Safe-area insets (viewport-fit=cover): the notch and the home indicator.
    // All env() values are 0 in a browser window, so this is inert there.
    <div
      className="flex h-full flex-col"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* No shell header: every screen carries its own top bar, and a second one
          above them would cost a phone a line of reading height for nothing. */}
      <main className="relative min-h-0 flex-1">
        <InfoHome
          screen={infoScreenFor(base)}
          onNavigate={onNavigate}
          configured={configured}
          onOpenSettings={openSettings}
          onTopicsChanged={refreshSavedArticles}
          renderLaunch={(launch) => (
            <PhoneHome
              launch={launch}
              savedCount={savedArticles.length}
              onOpenSaved={() => setStack((s) => push(s, screen("saved")))}
              settingsAlert={syncReport.alert !== "none"}
            />
          )}
        />

        {base.kind === "saved" && (
          <SavedList
            articles={savedArticles}
            onOpen={(article) => setStack((s) => push(s, { kind: "savedArticle", article }))}
            onBack={goBack}
          />
        )}

        {base.kind === "savedArticle" && (
          <SavedArticleView article={base.article} backLabel="Saved" onBack={goBack} />
        )}
      </main>

      <Toast toasts={toasts} onDismiss={dismissToast} />

      {showSettings && (
        <SettingsView
          settings={settings}
          onSettingsChange={(next) => {
            setSettings(next);
            saveSettings(next);
          }}
          onClose={goBack}
        />
      )}
    </div>
  );
}
