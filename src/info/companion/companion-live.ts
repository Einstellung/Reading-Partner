// Live wiring of the companion tool set (docs/16/17): binds the real fetch
// (infoFetch, browser UA), the readable extractor and the source store to the
// pure companion tools, and takes the host's briefing controller so
// generate_briefing can start a real run. Every info chat entry mounts this.
// The extractor is loaded on first use (readable-lazy) rather than imported
// here, so Readability/defuddle stay off the boot path.

import { infoFetch } from "../extract/http";
import { loadExtractReadable } from "../extract/readable-lazy";
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
import type { RequestOutcome } from "../briefing/reader";

// The briefing controller the host hands in so generate_briefing can kick a
// background job through the host's card lifecycle and hear what happened to it
// — a run started, a run was already going, or, on a device that does not
// collect, the request was left for the machine that does (docs/36). Kept as a
// small interface so the pure tool set stays host-agnostic.
export interface BriefingControl {
  start(scope: BriefingScope): RequestOutcome;
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
// Async only because the extractor's chunk is fetched here, before the tools
// that inject it exist; the tools themselves still get a plain synchronous
// extractor. The caller already awaits (it loads settings first), so the chat
// turn starts no later than it did.
export async function buildLiveCompanionTools(
  onProbeCard: (card: ProbeConfirmCardData) => void,
  onProfileCard: (card: ProfileUpdateCardData) => void,
  briefing: BriefingControl,
  opts: { collecting?: boolean } = {},
): Promise<AgentTool[]> {
  return buildCompanionTools({
    fetchFn: infoFetch,
    extract: await loadExtractReadable(),
    // trial_source proves a `webview` source only if it can open the window the
    // bodies come through; without this the trial reports feed summaries.
    fetchViaWebview: liveWebviewFetch(),
    addSource: (d) => addSource(d).then(() => {}),
    onProbeCard,
    onProfileCard,
    startBriefing: briefing.start,
    // Both halves of the sign-in gate. The webview is the first: without one
    // there is no window to open. Collecting is the second — a machine that does
    // not fetch article bodies has nowhere to spend a session, so signing in on
    // it would leave a cookie in a jar nobody reads. Not an error, just an
    // operation with no point, and a pointless tool in the list is one the model
    // will eventually reach for.
    siteSignIn: hasWebviewFetch() && opts.collecting !== false ? liveSiteSignIn() : undefined,
    // A reader does not get the add-source tools either (docs/36).
    // generate_briefing stays: on a reader the host turns it into a request for
    // the collector, and says so.
    collecting: opts.collecting,
  });
}
