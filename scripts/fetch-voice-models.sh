#!/usr/bin/env bash
# Fetch the on-device voice models the iOS audio front loads (docs/136): Silero
# VAD v6 and Smart Turn v3.2, both compiled CoreML. They are not vendored into
# git (17 MB); this pulls pinned Hugging Face revisions and checks every file's
# sha256, so a build gets these exact bytes or fails. Files already present
# with the right hash are not fetched again. Run before `tauri ios build`;
# src-tauri/tauri.ios.conf.json bundles src-tauri/voice-models/ into the app,
# license texts included.
set -euo pipefail
cd "$(dirname "$0")/.."
dst="src-tauri/voice-models"
hf="https://huggingface.co"
silero="$hf/FluidInference/silero-vad-coreml/resolve/b419383c55c110e2c9271fa6ee0ea83d03c70d96/silero-vad-unified-v6.0.0.mlmodelc"
turn="$hf/aufklarer/Smart-Turn-v3.2-CoreML/resolve/75f069717f500947195fa1945c46ddb472559cff/smart_turn.mlmodelc"

# local path | source | sha256
manifest="
silero-vad.mlmodelc/coremldata.bin|$silero/coremldata.bin|f460dcdf796b19c04bc38ab6e69601831f634e5e74d499487f0c8fe17ca12f0f
silero-vad.mlmodelc/metadata.json|$silero/metadata.json|282b1b788b5d4d66d6a70d468464a7ada71d2469a8705526b741fd9ab841295a
silero-vad.mlmodelc/model.mil|$silero/model.mil|79eea23c368f3e7edf85af798a953f5b0910e4b08ff48e55fff8545dd05fd047
silero-vad.mlmodelc/weights/weight.bin|$silero/weights/weight.bin|853cf34740d3f5061f977ebe2976f7c921b064261c9c4753b3a1196f2dba42b4
silero-vad.mlmodelc/analytics/coremldata.bin|$silero/analytics/coremldata.bin|2141be60ea0adf7acb1232fbcfaffb2be308ae02e6672d3762aedf36611ea9fd
smart-turn.mlmodelc/coremldata.bin|$turn/coremldata.bin|9245ac99889c9d738cba6c89da9e851fd16488bf8effbc15a109d06b401c9383
smart-turn.mlmodelc/model.mil|$turn/model.mil|41a6d9ac0f7d01d738e56ecdf4435e55f139591541b7cf1a4dba6b9ce2f1c9ef
smart-turn.mlmodelc/weights/weight.bin|$turn/weights/weight.bin|b6295316741a0149e1fcab7cdf030e1b9bfb0eef778207accee91a2a9703a39c
smart-turn.mlmodelc/analytics/coremldata.bin|$turn/analytics/coremldata.bin|1646746d0029e78d26be065e62602d4f89e51013ec238b653adf7d7d21057f89
"

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

fetched=0
while IFS='|' read -r path url want; do
  [ -n "$path" ] || continue
  file="$dst/$path"
  if [ -f "$file" ] && [ "$(sha "$file")" = "$want" ]; then continue; fi
  mkdir -p "$(dirname "$file")"
  curl -fsSL --retry 3 --max-time 300 -o "$file.part" "$url"
  got="$(sha "$file.part")"
  if [ "$got" != "$want" ]; then
    rm -f "$file.part"
    echo "sha256 mismatch for $path: got $got, want $want" >&2
    exit 1
  fi
  mv "$file.part" "$file"
  fetched=$((fetched + 1))
done <<< "$manifest"
echo "voice models in $dst ($fetched fetched)"
