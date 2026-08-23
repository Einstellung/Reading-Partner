import { useState } from "react";
import { setApiKey, type ProviderInfo } from "../../../ai";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { CARD } from "./cardStyles";

export default function KeyCard({
  providerId,
  name,
  providers,
  onActivated,
}: {
  providerId: "deepseek";
  name: string;
  providers: ProviderInfo[];
  onActivated: () => void;
}) {
  const provider = providers.find((p) => p.id === providerId);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await setApiKey(providerId, key);
      setKey("");
      onActivated();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between">
        <span className="font-medium">{name}</span>
        {provider?.configured && <span className="text-xs text-[#5fb236]">Connected</span>}
      </div>
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder={provider?.configured ? "Replace API key" : "API key"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <Button type="button" variant="outline" disabled={busy || !key.trim()} onClick={save}>
          Save
        </Button>
      </div>
      <p className="m-0 text-xs text-[#777]">Saving a key here signs out other providers.</p>
    </div>
  );
}
