# One-off: synthesize the turn-detection fixture with Kokoro and compute the
# reference values with the official Python implementations.
# usage: python -I make_fixture.py <dl dir> <worktree vocab.rs> <out dir>
import hashlib
import json
import re
import sys
import wave
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from scipy.signal import resample_poly

dl, vocab_rs, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
out.mkdir(parents=True, exist_ok=True)
torch.set_num_threads(4)

# --- Kokoro, 24 kHz -------------------------------------------------------
vocab = {chr(int(h, 16)): int(i) for h, i in re.findall(r"\('\\u\{([0-9a-f]+)\}', (\d+)\)", vocab_rs.read_text())}
voice = np.fromfile(dl / "kokoro/voices/af_maple.bin", dtype=np.float32).reshape(510, 256)
kok = ort.InferenceSession(str(dl / "kokoro/onnx/model.onnx"), providers=["CPUExecutionProvider"])


def say(ps):
    ids = [0] + [vocab[c] for c in ps] + [0]
    style = voice[min(max(len(ps), 1), 510) - 1][None, :]
    wav = kok.run(None, {"input_ids": np.array([ids], dtype=np.int64), "style": style,
                         "speed": np.array([1.0], dtype=np.float32)})[0]
    wav = np.asarray(wav, dtype=np.float64).reshape(-1)
    # Kokoro pads its output with near-silence; keep the voice and 30 ms.
    loud = np.nonzero(np.abs(wav) > 0.02 * np.abs(wav).max())[0]
    keep = int(0.03 * 24000)
    return wav[max(0, loud[0] - keep): loud[-1] + keep]


a = say("I θˈɪŋk wi ʃʊd")             # "I think we should"
b = say("ɡˈO hˈOm.")                   # "go home."
rate = 24000


def gap(s):
    return np.zeros(int(s * rate))


clip24 = np.concatenate([gap(0.2), a, gap(0.45), b, gap(0.3)])
clip = resample_poly(clip24, 2, 3)
rng = np.random.default_rng(7)
clip = clip / max(1e-9, np.abs(clip).max()) * 0.6 + rng.normal(0, 10 ** (-70 / 20), clip.shape)
pcm = np.clip(np.round(clip * 32768), -32768, 32767).astype(np.int16)
with wave.open(str(out / "clip.wav"), "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(16000)
    w.writeframes(pcm.tobytes())
x = pcm.astype(np.float32) / 32768.0
a_end = int(round((0.2 * rate + len(a)) * 2 / 3))  # end of utterance A, 16 kHz

# --- Silero, the official package ----------------------------------------
import silero_vad  # noqa: E402
from silero_vad import load_silero_vad  # noqa: E402

pkg_onnx = Path(silero_vad.__file__).parent / "data" / "silero_vad.onnx"
pkg_sha = hashlib.sha256(pkg_onnx.read_bytes()).hexdigest()
vad = load_silero_vad(onnx=True)
probs = []
for i in range(0, len(x) - 511, 512):
    probs.append(float(vad(torch.from_numpy(x[i:i + 512].copy()), 16000).item()))

# --- Smart Turn, pipecat's inference.py ----------------------------------
src = dl / "src"
sys.path.insert(0, str(src))
code = (src / "inference.py").read_text().replace(
    '"smart-turn-v3.1.onnx"', repr(str(dl / "models/smart-turn-v3.2-gpu.onnx")))
code = code.split('if __name__ == "__main__":')[0]
ns = {"__name__": "smart_turn_inference"}
exec(compile(code, str(src / "inference.py"), "exec"), ns)
cuts = {
    "mid": x[: a_end + int(0.3 * 16000)],
    "full": x,
    "long": np.concatenate([x, x, x]),
}
turn = {k: float(ns["predict_endpoint"](v)["probability"]) for k, v in cuts.items()}

feat = ns["feature_extractor"](
    ns["truncate_audio_to_last_n_seconds"](x, n_seconds=8), sampling_rate=16000, return_tensors="np",
    padding="max_length", max_length=8 * 16000, truncation=True, do_normalize=True,
).input_features.squeeze(0).astype(np.float32)
assert feat.shape == (80, 800), feat.shape
audio_frames = len(x) // 160
frames = sorted({f for f in range(800) if f % 100 == 0}
                | {f for f in range(max(0, 800 - audio_frames - 3), 800) if f % 4 == 0} | {799})
feat[:, frames].T.astype("<f4").tofile(out / "mel-ref.f32")

import transformers  # noqa: E402
import importlib.metadata as md  # noqa: E402

ref = {
    "made_by": "Kokoro-82M-v1.1-zh fp32, af_maple, 24 kHz -> 16 kHz resample_poly(2, 3), int16",
    "versions": {
        "silero-vad": md.version("silero-vad"), "silero_onnx_sha256": pkg_sha,
        "transformers": transformers.__version__, "onnxruntime": ort.__version__,
        "torch": torch.__version__, "smart-turn": "4786657e242dfe77dd138699ac564ee074a2a543",
    },
    "samples": len(x),
    "utterance_a_end": a_end,
    "silero": probs,
    "smart_turn": {"mid_samples": len(cuts["mid"]), "mid": turn["mid"], "full": turn["full"],
                   "long": turn["long"]},
    "mel_frames": frames,
}
(out / "reference.json").write_text(json.dumps(ref, indent=1) + "\n")
print(json.dumps({k: v for k, v in ref.items() if k not in ("silero", "mel_frames")}, indent=1))
print("frames", len(probs), "max p", max(probs), "mel frames", len(frames))
print("silero", " ".join(f"{p:.2f}" for p in probs))
