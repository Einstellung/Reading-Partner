// Live wiring of the companion tool set (docs/16/17): binds the real fetch
// (infoFetch, browser UA), the readable extractor and the source store to the
// pure companion tools, and takes the host's briefing controller so
// generate_briefing can start a real run. Every info chat entry mounts this.
// Imported only in the webview (extractReadable needs a DOM), never in bun tests.

import { infoFetch } from "../extract/http";
import { extractReadable } from "../extract/readable";
import { checkSiteSession, openSiteSignIn } from "../extract/webview-session";
import { hasWebviewFetch } from "../../platform/app/platform";
import {
  addSource,
  loadSiteSessions,
  loadSources,
  saveSiteSessions,
} from "../sources/source-store";
import { applySessionCheck, signInSites } from "../sources/site-session";
import { liveWebviewFetch } from "../sources/source-live";
import type { ProbeConfirmCardData } from "../sources/source-cards";
import type { ProfileUpdateCardData } from "../briefing/cards";
import { buildCompanionTools, type BriefingScope, type SiteSignInDeps } from "./companion-tools";
import type { AgentTool } from "../../ai/agent";

// The briefing controller the host hands in so generate_briefing can honestly
// report a run in flight and kick a background job through the host's card
// lifecycle. Kept as a small interface so the pure tool set stays host-agnostic.
export interface BriefingControl {
  running(): boolean;
  start(scope: BriefingScope): void;
}

// The sign-in half, bound to the real windows. The site list is read from the
// store per call rather than captured when the chat opened, so a source added a
// few turns ago is signed in to without reopening the conversation.
//
// The check writes the same sidecar the sources page reads, so the row there
// says what the chat just said (the page reloads it on entry).
function liveSiteSignIn(): SiteSignInDeps {
  return {
    signInSites: async () => signInSites(await loadSources()),
    openSignIn: (site) => openSiteSignIn(site.signInUrl),
    checkSession: async (site) => {
      const status = await checkSiteSession(site.checkUrl);
      const sessions = applySessionCheck(await loadSiteSessions(), site.host, status, Date.now());
      await saveSiteSessions(sessions);
      return status;
    },
  };
}

// The shared companion tool set bound live: the source tools, update_profile, and
// generate_briefing. The two card sinks surface the trial and profile-update
// confirm cards, and the briefing controller drives the regenerate tool.
//
// open_site_sign_in is mounted only where the webview commands exist (Linux
// desktop today). Elsewhere the tool is absent rather than present-and-failing,
// so the companion has nothing to promise and says the honest thing by default.
export function buildLiveCompanionTools(
  onProbeCard: (card: ProbeConfirmCardData) => void,
  onProfileCard: (card: ProfileUpdateCardData) => void,
  briefing: BriefingControl,
): AgentTool[] {
  return buildCompanionTools({
    fetchFn: infoFetch,
    extract: extractReadable,
    // trial_source proves a `webview` source only if it can open the window the
    // bodies come through; without this the trial reports feed summaries.
    fetchViaWebview: liveWebviewFetch(),
    addSource: (d) => addSource(d).then(() => {}),
    onProbeCard,
    onProfileCard,
    briefingRunning: briefing.running,
    startBriefing: briefing.start,
    siteSignIn: hasWebviewFetch() ? liveSiteSignIn() : undefined,
  });
}
