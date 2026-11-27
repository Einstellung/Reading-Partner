// The one card for every provider that takes a pasted key: pick the provider,
// paste, save. Four providers are on the card as chips; the rest, and the custom
// OpenAI-compatible endpoint, sit behind "More providers", which opens by itself
// when the connected choice is one of them (key-card-choices.ts).
//
// The model is not chosen here — the Default conversation card below lists the
// catalog of whichever provider ends up connected. The custom endpoint is the
// exception: its model is part of what is configured.

import { useId, useState } from "react";
import { setApiKey, type ProviderId, type ProviderInfo } from "../../../ai";
import { useT } from "../../../i18n";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { CARD } from "./cardStyles";
import CustomEndpointForm from "./CustomEndpointForm";
import {
  foldedChips,
  initialKeyProviderId,
  moreProvidersOpen,
  primaryChips,
  type KeyCardChoice,
  type ProviderChip,
} from "./key-card-choices";

export default function KeyCard({
  providers,
  onActivated,
}: {
  providers: ProviderInfo[];
  onActivated: (id: ProviderId) => void;
}) {
  const t = useT();
  const moreId = useId();
  const [picked, setPicked] = useState<KeyCardChoice | undefined>(undefined);
  const [toggled, setToggled] = useState<boolean | undefined>(undefined);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  // The connected provider is the default choice until the user picks another
  // one. Derived rather than held in state, because the provider list arrives
  // after the first render and a state copy would keep the pre-load answer.
  const connected = initialKeyProviderId(providers);
  const selected = picked ?? connected;
  // The selected provider is the one holding a key right now.
  const isConnected = connected !== undefined && selected === connected;
  const open = moreProvidersOpen(toggled, selected);

  const save = async () => {
    if (!selected || selected === "custom") return;
    setBusy(true);
    try {
      await setApiKey(selected, key);
      setKey("");
      onActivated(selected);
    } finally {
      setBusy(false);
    }
  };

  const chipButton = (id: KeyCardChoice, label: string) => (
    <Button
      key={id}
      type="button"
      size="chip"
      variant={id === selected ? "default" : "outline"}
      aria-pressed={id === selected}
      onClick={() => setPicked(id)}
    >
      {label}
    </Button>
  );
  const chips = (list: ProviderChip[]) => list.map((c) => chipButton(c.id, c.label));

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between">
        <span className="font-medium">{t("settings.apiKey")}</span>
        {isConnected && <span className="text-xs text-[#5fb236]">{t("settings.connected")}</span>}
      </div>
      <div className="flex flex-wrap gap-2">{chips(primaryChips())}</div>
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={moreId}
          onClick={() => setToggled(!open)}
        >
          <span aria-hidden className={open ? "inline-block rotate-90" : "inline-block"}>
            ›
          </span>
          {t("settings.key.more")}
        </Button>
      </div>
      {open && (
        <div id={moreId} className="flex flex-wrap gap-2">
          {chips(foldedChips())}
          {chipButton("custom", t("settings.custom.title"))}
        </div>
      )}
      {selected === "custom" ? (
        <CustomEndpointForm connected={isConnected} onActivated={() => onActivated("custom")} />
      ) : (
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder={isConnected ? t("settings.key.replace") : t("settings.apiKey")}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy || !selected || !key.trim()}
            onClick={save}
          >
            {t("settings.save")}
          </Button>
        </div>
      )}
      <p className="m-0 text-xs text-faint-foreground">{t("settings.key.signsOutOthers")}</p>
    </div>
  );
}
