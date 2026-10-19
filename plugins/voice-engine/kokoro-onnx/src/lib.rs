// On-device Kokoro-82M-v1.1-zh (docs/companion/136): misaki phonemes and a
// voice in, 24 kHz mono float samples out, on the CPU through ONNX Runtime.
// Shared by the voice plugin (iOS runs the engine in the app's own process) and
// the Android voice engine (docs/companion/89, the `:voice` process).
//
// The manifest, the tokenizer and the voice tables are plain Rust and build
// everywhere. The engine needs ONNX Runtime and is behind the `ort` feature.

pub mod manifest;
pub mod tokens;
mod vocab;
pub mod voice;

#[cfg(feature = "ort")]
pub mod engine;
