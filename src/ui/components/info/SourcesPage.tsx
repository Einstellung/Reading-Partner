// The source-list page (docs/17): the account of what the user subscribes to.
// One row per source (name, line, on/off toggle) with a health dot (green = last
// run succeeded, amber = last run failed; click for last-success time + error),
// a delete, and a paste-an-RSS-URL box at the top that probes + trials + adds in
// place, without going through the chat. No drag/group/frequency — ranking is
// triage's job. Presentational; the host owns the store writes and probing.
//
// Above the list, one row per site the reader can sign in to (site-session.ts):
// Bloomberg gives an anonymous reader a fifth of an article, so signing in is
// the difference between a headline and a story. Sites, not sources — seven
// Bloomberg sections share one login.

import { useEffect, useRef, useState } from "react";
import type { SourceDescriptor } from "../../../info/sources/descriptor";
import type { SourceHealth } from "../../../info/sources/engine";
import type { ProbeConfirmCardData } from "../../../info/sources/source-cards";
import type { ProbeAddOutcome } from "../../../info/sources/source-live";
import { pipeLabel } from "../../../info/sources/probe";
import {
  sessionRowLine,
  sessionWorkFor,
  signInSites,
  type SessionBusy,
  type SiteSessions,
  type SignInSite,
} from "../../../info/sources/site-session";
import { HIT_44 } from "../base/buttons";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { ProbeConfirmCard } from "./InfoCards";

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Green when the last run succeeded at least as recently as any failure; amber
// when the most recent outcome was a failure; grey when never run.
function healthState(h: SourceHealth | undefined): "ok" | "warn" | "unknown" {
  if (!h) return "unknown";
  const lastErr = h.lastErrorAt ?? 0;
  const lastOk = h.lastSuccess ?? 0;
  if (!lastErr && !lastOk) return "unknown";
  if (lastErr > lastOk) return "warn";
  return "ok";
}

function HealthDot({ health }: { health: SourceHealth | undefined }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const state = healthState(health);
  const color = state === "ok" ? "bg-[#3fb950]" : state === "warn" ? "bg-[#e3b341]" : "bg-[#d0d0d0]";

  // A press outside shuts the panel. Not blur: WebKit does not focus a button
  // when it is tapped, so on a touch device the dot never holds focus and a blur
  // never comes — docs/pitfall/67-webkit-tap-does-not-focus-a-button.md.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {/* The dot stays 10px — it reads as a status light, not a control — and
          HIT_44 makes it tappable. */}
      <button
        type="button"
        aria-label="Source health"
        onClick={() => setOpen((v) => !v)}
        className={`relative h-2.5 w-2.5 rounded-full ${HIT_44} ${color}`}
      />
      {open && health && (
        <div className="absolute right-0 top-4 z-10 w-56 rounded-lg border border-black/10 bg-white p-3 text-left text-[12px] shadow-lg">
          {health.lastSuccess ? (
            <div className="text-[#555]">Last success: {timeAgo(health.lastSuccess)}</div>
          ) : (
            <div className="text-[#999]">No successful run yet.</div>
          )}
          {health.lastError && (
            <div className="mt-1.5 text-[#c0392b]">
              {health.lastErrorAt ? `${timeAgo(health.lastErrorAt)}: ` : ""}
              {health.lastError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// One site's sign-in row. The state is the host's; the work (a window the user
// types into, a page load, a cookie delete) belongs to the host too.
function SignInRow(props: {
  site: SignInSite;
  sessions: SiteSessions;
  busy: SessionBusy | null;
  onSignIn: (site: SignInSite) => void;
  onCheck: (site: SignInSite) => void;
  onSignOut: (site: SignInSite) => void;
}) {
  const { site, sessions, busy } = props;
  const state = sessions[site.host];
  const work = sessionWorkFor(busy, site.host);
  const working = work !== null;
  const signedIn = !!state && !state.unknown && state.signedIn;
  return (
    <li className="flex items-center gap-3 rounded-xl border border-[#e6e6e6] bg-white px-4 py-3">
      <span
        aria-hidden
        className={`h-2.5 w-2.5 flex-none rounded-full ${signedIn ? "bg-[#3fb950]" : "bg-[#d0d0d0]"}`}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium text-[#1b1b1b]">{site.label}</div>
        <div className="truncate text-[12px] text-[#999]">
          {sessionRowLine(site, state, work)}
        </div>
      </div>
      <Button
        variant="subtle"
        size="chip"
        disabled={working}
        onClick={() => props.onCheck(site)}
        title="Load the site in the background and see whether it still asks you to sign in"
      >
        Check
      </Button>
      {signedIn ? (
        <Button variant="subtle" size="chip" disabled={working} onClick={() => props.onSignOut(site)}>
          Sign out
        </Button>
      ) : (
        <Button variant="cta" size="chip" disabled={working} onClick={() => props.onSignIn(site)}>
          Sign in
        </Button>
      )}
    </li>
  );
}

export interface SourcesPageProps {
  sources: SourceDescriptor[];
  health: Record<string, SourceHealth>;
  // Last known sign-in state per site, and the three things a reader can do
  // about it. Absent on a platform with no webview — the section then draws
  // nothing, because there is nothing to sign in to.
  sessions?: SiteSessions;
  // The site currently being worked on and what is being done to it, so its row
  // can say which of the two waits the reader is in.
  sessionBusy?: SessionBusy | null;
  onSignIn?: (site: SignInSite) => void;
  onCheckSession?: (site: SignInSite) => void;
  onSignOut?: (site: SignInSite) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onRemove: (id: string) => void;
  // Probe + trial in one shot, on a device that can do it. `onSlowTrial` fires
  // when the trial is about to fetch a body through a browser window, which is
  // tens of seconds of nothing to look at otherwise.
  //
  // Absent on a reader (docs/36): a trial has to really fetch three articles to
  // prove the source works, and a reader has no webview to fetch them with — the
  // same Bloomberg source trials to a full story on the collector and to a
  // standfirst here.
  onProbeAdd?: (url: string, onSlowTrial?: () => void) => Promise<ProbeAddOutcome>;
  onConfirmAdd?: (descriptor: SourceDescriptor) => Promise<void>;
  // What the collecting machine's sessions look like, for a device that cannot
  // sign in itself. Absent on the collector, which draws the real rows above.
  collectorSites?: { deviceName: string; sites: Record<string, boolean> } | null;
  onBack: () => void;
}

export function SourcesPage(props: SourcesPageProps) {
  const [url, setUrl] = useState("");
  const [probing, setProbing] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ProbeConfirmCardData | null>(null);
  const sites = signInSites(props.sources);

  async function probe() {
    const input = url.trim();
    if (!input || probing || !props.onProbeAdd) return;
    setProbing(true);
    setSlow(false);
    setError(null);
    setPending(null);
    try {
      const r = await props.onProbeAdd(input, () => setSlow(true));
      if (r.ok) setPending(r.card);
      else setError(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProbing(false);
      setSlow(false);
    }
  }

  async function confirmAdd() {
    if (!pending || !props.onConfirmAdd) return;
    await props.onConfirmAdd(pending.descriptor);
    setPending((p) => (p ? { ...p, added: true } : p));
    setUrl("");
    setTimeout(() => setPending(null), 800);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-4 py-5 sm:px-6 sm:py-8">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="subtle" size="chip" onClick={props.onBack}>
          ‹ Briefing
        </Button>
        <span className="text-[15px] font-medium text-[#1b1b1b]">Sources</span>
      </div>

      {/* Add by URL, where a URL can be proved to work. */}
      {!props.onProbeAdd ? (
        <p className="mb-6 mt-0 text-[13px] leading-relaxed text-[#999]">
          Sources are added on the computer that collects them — proving one works means fetching
          three articles from it, which only that machine can do.
        </p>
      ) : (
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void probe();
              }
            }}
            placeholder="Paste a site or RSS URL…"
            className="min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1b1b1b] outline-none coarse:min-h-[44px] coarse:text-[16px] placeholder:text-neutral-400 focus:border-primary"
          />
          <Button type="button" variant="cta" size="lg" onClick={() => void probe()} disabled={!url.trim() || probing}>
            {probing ? "Checking…" : "Add"}
          </Button>
        </div>
        {slow && (
          <div className="mt-2 text-[13px] text-[#666]">
            This site is read through a background browser window — fetching one article to test it takes up to a minute.
          </div>
        )}
        {error && <div className="mt-2 text-[13px] text-[#c0392b]">{error}</div>}
        {pending && (
          <div className="mt-3">
            <ProbeConfirmCard
              payload={pending}
              surface="call"
              dispatch={(a) => {
                if (a.kind === "mutate" && a.op === "add-source") void confirmAdd();
              }}
            />
          </div>
        )}
      </div>
      )}

      {/* What the collecting machine's sessions look like, on a device that has
          no webview to sign in with (docs/36). Read-only on purpose: the cookie
          is on that machine, so that machine is the only place to repair it. */}
      {sites.length > 0 && !props.onSignIn && props.collectorSites && (
        <div className="mb-6">
          <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-[#999]">
            Signed-in sites
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {sites.map((site) => {
              const signedIn = props.collectorSites?.sites[site.host] === true;
              return (
                <li
                  key={site.host}
                  className="flex items-center gap-3 rounded-xl border border-[#e6e6e6] bg-white px-4 py-3"
                >
                  <span
                    aria-hidden
                    className={`h-2.5 w-2.5 flex-none rounded-full ${signedIn ? "bg-[#3fb950]" : "bg-[#d0d0d0]"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-[#1b1b1b]">
                      {site.label}
                    </div>
                    <div className="truncate text-[12px] text-[#999]">
                      {signedIn
                        ? `Signed in on ${props.collectorSites?.deviceName}`
                        : `Needs signing in on ${props.collectorSites?.deviceName} for the full text`}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Sites with a sign-in. Nothing to draw when no source has one, or when
          the platform has no webview to sign in with. */}
      {sites.length > 0 && props.onSignIn && (
        <div className="mb-6">
          <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-[#999]">
            Signed-in sites
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {sites.map((site) => (
              <SignInRow
                key={site.host}
                site={site}
                sessions={props.sessions ?? {}}
                busy={props.sessionBusy ?? null}
                onSignIn={props.onSignIn!}
                onCheck={props.onCheckSession ?? (() => {})}
                onSignOut={props.onSignOut ?? (() => {})}
              />
            ))}
          </ul>
          <p className="mt-2 text-[12px] leading-relaxed text-[#999]">
            Signing in opens the site's own page in a window. Close it when you are done — your
            password never reaches this app, and only the site's cookie stays behind.
          </p>
        </div>
      )}

      {/* The list. */}
      {props.sources.length === 0 ? (
        <p className="my-3.5 text-[14px] text-[#999]">
          {props.onProbeAdd
            ? "No sources yet. Paste a URL above to add one."
            : "No sources yet."}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {props.sources.map((s) => (
            <li
              key={s.id}
              className="group flex items-center gap-3 rounded-xl border border-[#e6e6e6] bg-white px-4 py-3"
            >
              <HealthDot health={props.health[s.id]} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-[#1b1b1b]">{s.name}</div>
                <div className="truncate text-[12px] text-[#999]">
                  {[s.line, pipeLabel(s)].filter(Boolean).join(" · ")}
                </div>
              </div>
              <Switch
                checked={s.enabled}
                aria-label={`Enable ${s.name}`}
                onCheckedChange={(v) => props.onToggle(s.id, v)}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove source"
                title="Remove"
                onClick={() => props.onRemove(s.id)}
                className="h-7 w-7 flex-none rounded-full text-[#bbb] can-hover:opacity-0 transition-opacity can-hover:hover:text-[#c0392b] group-hover:opacity-100"
              >
                ✕
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
