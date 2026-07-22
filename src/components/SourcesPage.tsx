// The source-list page (docs/17): the account of what the user subscribes to.
// One row per source (name, line, on/off toggle) with a health dot (green = last
// run succeeded, amber = last run failed; click for last-success time + error),
// a delete, and a paste-an-RSS-URL box at the top that probes + trials + adds in
// place, without going through the chat. No drag/group/frequency — ranking is
// triage's job. Presentational; the host owns the store writes and probing.

import { useState } from "react";
import type { SourceDescriptor } from "../info/descriptor";
import type { SourceHealth } from "../info/engine";
import type { ProbeConfirmCardData } from "../info/cards";
import type { ProbeAddOutcome } from "../info/source-live";
import { pipeLabel } from "../info/probe";
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
  const state = healthState(health);
  const color = state === "ok" ? "bg-[#3fb950]" : state === "warn" ? "bg-[#e3b341]" : "bg-[#d0d0d0]";
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Source health"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        className={`h-2.5 w-2.5 rounded-full ${color}`}
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

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={
        "relative h-5 w-9 flex-none rounded-full transition-colors " + (on ? "bg-[#6d5ae0]" : "bg-[#d4d4d4]")
      }
    >
      <span
        className={"absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform " + (on ? "translate-x-4" : "translate-x-0.5")}
      />
    </button>
  );
}

export interface SourcesPageProps {
  sources: SourceDescriptor[];
  health: Record<string, SourceHealth>;
  onToggle: (id: string, enabled: boolean) => void;
  onRemove: (id: string) => void;
  onProbeAdd: (url: string) => Promise<ProbeAddOutcome>;
  onConfirmAdd: (descriptor: SourceDescriptor) => Promise<void>;
  onBack: () => void;
}

export function SourcesPage(props: SourcesPageProps) {
  const [url, setUrl] = useState("");
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ProbeConfirmCardData | null>(null);

  async function probe() {
    const input = url.trim();
    if (!input || probing) return;
    setProbing(true);
    setError(null);
    setPending(null);
    try {
      const r = await props.onProbeAdd(input);
      if (r.ok) setPending(r.card);
      else setError(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProbing(false);
    }
  }

  async function confirmAdd() {
    if (!pending) return;
    await props.onConfirmAdd(pending.descriptor);
    setPending((p) => (p ? { ...p, added: true } : p));
    setUrl("");
    setTimeout(() => setPending(null), 800);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <button
          className="rounded-lg border border-[#dcdcdc] px-2.5 py-1 text-[13px] text-[#555] hover:bg-[#f4f4f4]"
          onClick={props.onBack}
        >
          ‹ Briefing
        </button>
        <span className="text-[15px] font-medium text-[#1b1b1b]">Sources</span>
      </div>

      {/* Add by URL. */}
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
            className="min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1b1b1b] outline-none placeholder:text-neutral-400 focus:border-[#6d5ae0]"
          />
          <button
            type="button"
            onClick={() => void probe()}
            disabled={!url.trim() || probing}
            className="rounded-lg bg-[#6d5ae0] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#5d4bd0] disabled:opacity-40"
          >
            {probing ? "Checking…" : "Add"}
          </button>
        </div>
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

      {/* The list. */}
      {props.sources.length === 0 ? (
        <p className="text-[14px] text-[#999]">No sources yet. Paste a URL above to add one.</p>
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
              <Toggle on={s.enabled} onChange={(v) => props.onToggle(s.id, v)} />
              <button
                aria-label="Remove source"
                title="Remove"
                onClick={() => props.onRemove(s.id)}
                className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-[#bbb] opacity-0 transition-opacity hover:bg-[#f0f0f0] hover:text-[#c0392b] group-hover:opacity-100"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
