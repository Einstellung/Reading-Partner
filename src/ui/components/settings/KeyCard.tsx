// The one card for every provider that takes a pasted key: pick the provider,
// paste, save. The model is not chosen here — the Default conversation card
// below lists the models of whichever provider ends up connected.

import { useState } from "react";
import { setApiKey, type ApiKeyProviderId, type ProviderInfo } from "../../../ai";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { CARD } from "./cardStyles";
import { ChoiceField, FieldGrid } from "./ChoiceField";
import { initialKeyProviderId, keyProviderChoices } from "./key-card-choices";

export default function KeyCard({
  providers,
  onActivated,
}: {
  providers: ProviderInfo[];
  onActivated: (id: ApiKeyProviderId) => void;
}) {
  const [picked, setPicked] = useState<ApiKeyProviderId | undefined>(undefined);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  // The connected provider is the default choice until the user picks another
  // one. Derived rather than held in state, because the provider list arrives
  // after the first render and a state copy would keep the pre-load answer.
  const connected = initialKeyProviderId(providers);
  const selected = picked ?? connected;
  // The selected provider is the one holding a key right now.
  const isConnected = connected !== undefined && selected === connected;

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await setApiKey(selected, key);
      setKey("");
      onActivated(selected);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between">
        <span className="font-medium">API key</span>
        {isConnected && <span className="text-xs text-[#5fb236]">Connected</span>}
      </div>
      <FieldGrid>
        <ChoiceField
          label="Provider"
          placeholder="Select…"
          value={selected}
          choices={keyProviderChoices()}
          onChange={(id) => setPicked(id as ApiKeyProviderId)}
        />
      </FieldGrid>
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder={isConnected ? "Replace API key" : "API key"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy || !selected || !key.trim()}
          onClick={save}
        >
          Save
        </Button>
      </div>
      <p className="m-0 text-xs text-[#777]">Saving a key here signs out other providers.</p>
    </div>
  );
}
