// The source-list page (docs/63): the account of what the user subscribes to —
// which sources there are, which research rooms read each one, and how healthy
// each is. One row per source (name, line, the rooms that read it, on/off
// toggle) with a health dot (green = last run succeeded, amber = last run
// failed; click for last-success time + error) and a delete. Adding is not on
// this page: a source is added by telling the AI to add it (the `add_source`
// tool), so there is no URL box here. No drag/group/frequency — ranking is
// triage's job. Presentational; the host owns the store writes.
//
// Above the list, one row per site the reader can sign in to (site-session.ts):
// Bloomberg gives an anonymous reader a fifth of an article, so signing in is
// the difference between a headline and a story. Sites, not sources — seven
// Bloomberg sections share one login.

import { useEffect, useRef, useState } from "react";
import type { SourceDescriptor } from "../../../info/sources/descriptor";
import type { SourceHealth } from "../../../info/sources/engine";
import type { Lab } from "../../../info/labs/types";
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
import { roomsUsingSource } from "./sources-page";

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
  const color = state === "ok" ? "bg-[#3fb950]" : state === "warn" ? "bg-[#e3b341]" : "bg-muted-strong";

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
        <div className="absolute right-0 top-4 z-10 w-56 rounded-lg border border-border bg-popover p-3 text-left text-[12px] shadow-lg">
          {health.lastSuccess ? (
            <div className="text-muted-foreground">Last success: {timeAgo(health.lastSuccess)}</div>
          ) : (
            <div className="text-faint-foreground">No successful run yet.</div>
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
    <li className="flex items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3">
      <span
        aria-hidden
        className={`h-2.5 w-2.5 flex-none rounded-full ${signedIn ? "bg-[#3fb950]" : "bg-muted-strong"}`}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium text-foreground">{site.label}</div>
        <div className="truncate text-[12px] text-faint-foreground">
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
  // The reader's research rooms, for the "read by" chips under each row. The
  // rooms a source is read by is roomsUsingSource's answer, not a field on the
  // source: a source nobody claimed is read by all of them.
  labs: Lab[];
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
  // What the collecting machine's sessions look like, for a device that cannot
  // sign in itself. Absent on the collector, which draws the real rows above.
  collectorSites?: { deviceName: string; sites: Record<string, boolean> } | null;
  onBack: () => void;
}

export function SourcesPage(props: SourcesPageProps) {
  const sites = signInSites(props.sources);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-4 py-5 sm:px-6 sm:py-8">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="subtle" size="chip" onClick={props.onBack}>
          ‹ Briefing
        </Button>
        <span className="text-[15px] font-medium text-foreground">Sources</span>
      </div>

      {/* Adding is a thing you say, not a thing you type here (docs/63). */}
      <p className="mb-6 mt-0 text-[13px] leading-relaxed text-faint-foreground">
        To add a source, tell the AI about it — say the site or feed you want followed and it
        checks the source works before it goes on this list.
      </p>

      {/* What the collecting machine's sessions look like, on a device that has
          no webview to sign in with (docs/36). Read-only on purpose: the cookie
          is on that machine, so that machine is the only place to repair it. */}
      {sites.length > 0 && !props.onSignIn && props.collectorSites && (
        <div className="mb-6">
          <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-faint-foreground">
            Signed-in sites
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {sites.map((site) => {
              const signedIn = props.collectorSites?.sites[site.host] === true;
              return (
                <li
                  key={site.host}
                  className="flex items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3"
                >
                  <span
                    aria-hidden
                    className={`h-2.5 w-2.5 flex-none rounded-full ${signedIn ? "bg-[#3fb950]" : "bg-muted-strong"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-foreground">
                      {site.label}
                    </div>
                    <div className="truncate text-[12px] text-faint-foreground">
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
          <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-faint-foreground">
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
          <p className="mt-2 text-[12px] leading-relaxed text-faint-foreground">
            Signing in opens the site's own page in a window. Close it when you are done — your
            password never reaches this app, and only the site's cookie stays behind.
          </p>
        </div>
      )}

      {/* The list. */}
      {props.sources.length === 0 ? (
        <p className="my-3.5 text-[14px] text-faint-foreground">No sources yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {props.sources.map((s) => {
            const rooms = roomsUsingSource(props.labs, s.id);
            return (
              <li
                key={s.id}
                className="group flex items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3"
              >
                <HealthDot health={props.health[s.id]} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium text-foreground">{s.name}</div>
                  <div className="truncate text-[12px] text-faint-foreground">
                    {[s.line, pipeLabel(s)].filter(Boolean).join(" · ")}
                  </div>
                  {rooms.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {rooms.map((name) => (
                        <span
                          key={name}
                          className="rounded-full border border-border-soft px-2 py-0.5 text-[11px] text-muted-foreground"
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  )}
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
                  className="h-7 w-7 flex-none rounded-full text-faint-foreground can-hover:opacity-0 transition-opacity can-hover:hover:text-[#c0392b] group-hover:opacity-100"
                >
                  ✕
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
