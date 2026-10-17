// Which files make up the on-device voice, pinned to one Hugging Face
// revision. A new revision is a new directory: nothing downloaded under one
// revision is ever trusted under another.
//
// onnx-community/Kokoro-82M-v1.1-zh-ONNX is Apache-2.0, as is the model it
// converts (hexgrad/Kokoro-82M-v1.1-zh). Inputs: `input_ids` int64 [1, n],
// `style` f32 [1, 256], `speed` f32 [1]; output `waveform` f32 [1, samples].

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const REPO: &str = "onnx-community/Kokoro-82M-v1.1-zh-ONNX";
pub const REVISION: &str = "6cc0f0d2ebe369a68b0df87c2b65c1af8c0ac3e3";
/// Where under local app data the files go: one directory per revision.
pub const DIR: &str = "voice-models/kokoro-v1.1-zh";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelFile {
    /// Path inside the repository, which is also the path under the local root.
    pub path: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Variant {
    Fp32,
    Fp16,
    Int8,
}

impl Variant {
    pub const ALL: [Variant; 3] = [Variant::Fp32, Variant::Fp16, Variant::Int8];

    pub fn file(self) -> ModelFile {
        match self {
            Variant::Fp32 => ModelFile {
                path: "onnx/model.onnx",
                size: 339_369_442,
                sha256: "94b973941b1852754f979be5d5e20be666d5c81d9bb886b88ae1dc85c9b895ca",
            },
            Variant::Fp16 => ModelFile {
                path: "onnx/model_fp16.onnx",
                size: 163_630_554,
                sha256: "d59cb626c885c91acb7ecf7250f26f9915ad0af99b770572000d90b598c3dfbc",
            },
            // Dynamic int8 quantization of the weights (MatMul/Conv); the
            // repo's model_quantized/model_uint8 are the uint8 twin.
            Variant::Int8 => ModelFile {
                path: "onnx/model_int8.onnx",
                size: 127_356_504,
                sha256: "58b9b997faeaf42b427bac24c8a6246b236b0561311f6b118318cd9d2f47acb1",
            },
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Variant::Fp32 => "fp32",
            Variant::Fp16 => "fp16",
            Variant::Int8 => "int8",
        }
    }
}

/// The voices: zf_001 speaks the Chinese, af_maple the English, the pair the
/// v1.1-zh samples use.
pub const VOICES: [(&str, ModelFile); 2] = [
    (
        "zf_001",
        ModelFile {
            path: "voices/zf_001.bin",
            size: 522_240,
            sha256: "0a89ec12bb93fb9c74077924daf02568baad64e1f869389f5aaee01a386035f8",
        },
    ),
    (
        "af_maple",
        ModelFile {
            path: "voices/af_maple.bin",
            size: 522_240,
            sha256: "bd5b230b916ea98c67a3a7a833a3ce43e535ce56a81503f4166ee9390b9ddeeb",
        },
    ),
];

pub fn voice_file(name: &str) -> Option<ModelFile> {
    VOICES.iter().find(|(n, _)| *n == name).map(|(_, f)| *f)
}

pub fn url(file: &ModelFile) -> String {
    format!("https://huggingface.co/{REPO}/resolve/{REVISION}/{}", file.path)
}

/// The revision's own directory under `base` (local app data).
pub fn root(base: &Path) -> PathBuf {
    base.join(DIR).join(REVISION)
}

/// What a download of these variants fetches: the models, then every voice.
pub fn files_for(variants: &[Variant]) -> Vec<ModelFile> {
    let mut out: Vec<ModelFile> = Vec::new();
    for v in Variant::ALL {
        if variants.contains(&v) {
            out.push(v.file());
        }
    }
    out.extend(VOICES.iter().map(|(_, f)| *f));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_pin_the_revision() {
        let u = url(&Variant::Int8.file());
        assert_eq!(
            u,
            "https://huggingface.co/onnx-community/Kokoro-82M-v1.1-zh-ONNX/resolve/6cc0f0d2ebe369a68b0df87c2b65c1af8c0ac3e3/onnx/model_int8.onnx"
        );
    }

    #[test]
    fn hashes_are_sha256_hex() {
        for f in files_for(&Variant::ALL) {
            assert_eq!(f.sha256.len(), 64, "{}", f.path);
            assert!(f.sha256.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
            assert!(f.size > 0);
        }
    }

    #[test]
    fn files_for_keeps_order_and_always_has_voices() {
        let f = files_for(&[Variant::Int8, Variant::Fp32]);
        let paths: Vec<_> = f.iter().map(|f| f.path).collect();
        assert_eq!(
            paths,
            ["onnx/model.onnx", "onnx/model_int8.onnx", "voices/zf_001.bin", "voices/af_maple.bin"]
        );
        assert_eq!(files_for(&[]).len(), 2);
        assert_eq!(voice_file("zf_001").unwrap().path, "voices/zf_001.bin");
        assert!(voice_file("zm_009").is_none());
    }

    #[test]
    fn variant_wire_names() {
        assert_eq!(serde_json::to_string(&Variant::Fp16).unwrap(), "\"fp16\"");
        let v: Variant = serde_json::from_str("\"int8\"").unwrap();
        assert_eq!(v, Variant::Int8);
    }
}
