// The custom OpenAI-compatible endpoint, inside the API-key card: base URL, key,
// model. The model list is asked for once the URL and key are usable; when the
// endpoint gives none, the model is typed. Saving first sends a test request
// with a tool on it, and only an endpoint that answers with a tool call is
// stored (src/ai/custom-provider.ts).

import { useEffect, useState } from "react";
import {
  checkBaseUrl,
  currentCustomEndpoint,
  fetchCustomModels,
  probeToolCalls,
  saveCustomEndpoint,
} from "../../../ai";
import { useT } from "../../../i18n";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ChoiceField, FieldGrid } from "./ChoiceField";
import { modelListRequest, urlProblem, verdictMessage, type VerdictMessage } from "./custom-endpoint-form";

export default function CustomEndpointForm({
  connected,
  onActivated,
}: {
  connected: boolean;
  onActivated: () => void;
}) {
  const t = useT();
  const stored = connected ? currentCustomEndpoint() : null;
  const [url, setUrl] = useState(stored?.baseUrl ?? "");
  const [key, setKey] = useState("");
  const [model, setModel] = useState(stored?.modelId ?? "");
  // undefined: not asked yet (or the URL/key changed); null: asking.
  const [listed, setListed] = useState<string[] | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<VerdictMessage | null>(null);

  const request = modelListRequest(url, key);
  const requestKey = request ? `${request.baseUrl}\n${request.key}` : "";

  // Asked for after the typing stops, not on every keystroke.
  useEffect(() => {
    setListed(undefined);
    if (!request) return;
    let live = true;
    const timer = setTimeout(() => {
      setListed(null);
      void fetchCustomModels(request.baseUrl, request.key).then((ids) => {
        if (live) setListed(ids);
      });
    }, 600);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // requestKey stands for `request`, which is a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const problem = urlProblem(url);
  const canSave = !!request && !!model.trim() && !busy;

  const save = async () => {
    const check = checkBaseUrl(url);
    if (!check.ok || !request) return;
    const endpoint = { baseUrl: check.url, modelId: model.trim() };
    setBusy(true);
    setMessage(null);
    try {
      const verdict = await probeToolCalls(endpoint, request.key);
      const failed = verdictMessage(verdict);
      if (failed) {
        setMessage(failed);
        return;
      }
      await saveCustomEndpoint(endpoint, request.key);
      setKey("");
      onActivated();
    } finally {
      setBusy(false);
    }
  };

  const fieldLabel = (text: string, htmlFor: string) => (
    <Label layout="detached" htmlFor={htmlFor}>
      {text}
    </Label>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        {fieldLabel(t("settings.custom.baseUrl"), "custom-endpoint-url")}
        <Input
          id="custom-endpoint-url"
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t("settings.custom.baseUrlPlaceholder")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        {fieldLabel(t("settings.apiKey"), "custom-endpoint-key")}
        <Input
          id="custom-endpoint-key"
          type="password"
          placeholder={connected ? t("settings.key.replace") : t("settings.apiKey")}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </div>
      {problem && <p className="m-0 text-xs text-destructive">{t(`settings.${problem}`)}</p>}
      {listed === null && <p className="m-0 text-xs text-faint-foreground">{t("settings.custom.loadingModels")}</p>}
      {listed && listed.length > 0 ? (
        <FieldGrid>
          <ChoiceField
            label={t("settings.custom.model")}
            placeholder={t("settings.account.select")}
            value={listed.includes(model) ? model : undefined}
            choices={listed.map((id) => ({ value: id, label: id }))}
            onChange={setModel}
          />
        </FieldGrid>
      ) : (
        listed !== null && (
          <div className="flex flex-col gap-1">
            <Input
              aria-label={t("settings.custom.model")}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t("settings.custom.modelPlaceholder")}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            {listed && <p className="m-0 text-xs text-faint-foreground">{t("settings.custom.noModelList")}</p>}
          </div>
        )
      )}
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" disabled={!canSave} onClick={save}>
          {busy ? t("settings.custom.testing") : t("settings.custom.testAndSave")}
        </Button>
      </div>
      {message && (
        <p role="alert" className="m-0 text-xs text-destructive">
          {message.key === "custom.failed"
            ? t("settings.custom.failed", { detail: message.detail })
            : t(`settings.${message.key}`)}
        </p>
      )}
    </div>
  );
}
