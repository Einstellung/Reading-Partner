import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

// The "API key" row of a voice card: a password field, Save, and "Connected"
// once a key is stored. What storing means is the card's (`save`); the row
// re-reads `has` after it so "Connected" reflects what actually landed.
export default function ApiKeyField({
  has,
  save,
  placeholder,
  replacePlaceholder,
}: {
  has(): Promise<boolean>;
  save(key: string): Promise<void>;
  placeholder: string;
  replacePlaceholder: string;
}) {
  const [configured, setConfigured] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    has().then(setConfigured);
  }, []);

  const saveKey = async () => {
    setBusy(true);
    try {
      await save(key);
      setKey("");
      setConfigured(await has());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Label layout="stack">
      API key
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder={configured ? replacePlaceholder : placeholder}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <Button type="button" variant="outline" disabled={busy || !key.trim()} onClick={saveKey}>
          Save
        </Button>
        {configured && <span className="self-center text-xs text-[#5fb236]">Connected</span>}
      </div>
    </Label>
  );
}
