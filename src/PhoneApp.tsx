// The phone shell (docs/22), beside App.tsx. Info only: today's briefing, the
// articles it produced, the ones kept out of it, the companion chat over any of
// them, and settings. No reader, no annotations, no notes — the phone never
// opens a book, so none of App's reading state exists here.
//
// The briefing pipeline, the article cache and the info call stay in InfoHome,
// which both shells mount; this file owns which screen is showing, the kept
// articles, settings and sync.

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
import SavedArticleView from "./ui/components/library/SavedArticleView";
import SettingsView from "./ui/components/SettingsView";
import Toast, { useToasts } from "./ui/components/common/Toast";
import { useSyncHealth } from "./ui/components/common/useSyncHealth";

// The screens this shell navigates between. The first four are InfoHome's, under
// their phone names; "saved" is this shell's own.
type PhoneScreen = "home" | "briefing" | "article" | "sources" | "saved";

// InfoHome's screen for a phone screen, or null on the ones it does not draw.
// Null keeps it mounted with its pipeline and its opened article intact, the
// same way App parks it while the reader is open.
function infoScreenFor(screen: PhoneScreen): HomeScreen | null {
  switch (screen) {
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
  const [screen, setScreen] = useState<PhoneScreen>("home");
  // The kept articles (docs/21), and the one being read. Fixed to the Brief
  // topic: the phone has no other place to file one from.
  const [savedArticles, setSavedArticles] = useState<SavedArticle[]>([]);
  const [openSaved, setOpenSaved] = useState<SavedArticle | null>(null);
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [showSettings, setShowSettings] = useState(false);
  const [providersInfo, setProvidersInfo] = useState<ProviderInfo[]>([]);
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

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

  // InfoHome navigates in its own vocabulary; "library" cannot arrive, since the
  // phone home screen has no way there.
  const onNavigate = useCallback((next: HomeScreen) => {
    setScreen(next === "vestibule" || next === "library" ? "home" : next);
  }, []);

  const openSettings = useCallback(() => setShowSettings(true), []);

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
          screen={infoScreenFor(screen)}
          onNavigate={onNavigate}
          configured={configured}
          onOpenSettings={openSettings}
          onTopicsChanged={refreshSavedArticles}
          renderLaunch={(launch) => (
            <PhoneHome
              launch={launch}
              savedCount={savedArticles.length}
              onOpenSaved={() => setScreen("saved")}
              settingsAlert={syncReport.alert !== "none"}
            />
          )}
        />

        {screen === "saved" &&
          (openSaved ? (
            <SavedArticleView
              article={openSaved}
              backLabel="Saved"
              onBack={() => setOpenSaved(null)}
            />
          ) : (
            <SavedList
              articles={savedArticles}
              onOpen={setOpenSaved}
              onBack={() => setScreen("home")}
            />
          ))}
      </main>

      <Toast toasts={toasts} onDismiss={dismissToast} />

      {showSettings && (
        <SettingsView
          settings={settings}
          onSettingsChange={(next) => {
            setSettings(next);
            saveSettings(next);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
