// On-device Kokoro-82M-v1.1-zh (docs/companion/136): misaki phonemes and a
// voice in, 24 kHz mono PCM out, on the CPU through ONNX Runtime.
//
// The text front end (another crate) produces the exact phoneme string
// `kokoro.KPipeline` feeds the model; this module never sees text. One call is
// one sentence: the caller cuts long text at punctuation so the first sentence
// can play while the rest are synthesized.
//
// The weights are not in the app. `download` fetches a pinned Hugging Face
// revision into local app data, resuming where a broken transfer stopped and
// checking every file's sha256 before it counts as present. Until that has
// happened iOS has no voice (tts/kokoro.rs speaks with this module).
//
// What compiles where: the manifest, the downloader, the tokenizer and the
// voice tables are plain Rust and build everywhere. The engine and the bench
// need ONNX Runtime and are behind the `kokoro` feature, which src-tauri turns
// on for iOS only.

pub mod download;
pub mod manifest;
pub mod tokens;
mod vocab;
pub mod voice;

#[cfg(feature = "kokoro")]
pub mod bench;
#[cfg(feature = "kokoro")]
pub mod engine;

/// The plugin's one downloader, managed state.
pub struct KokoroModels(pub std::sync::Arc<download::Downloader>);

/// Kokoro's output rate.
pub const SAMPLE_RATE_HZ: u32 = 24_000;

/// Float samples to 16-bit little-endian PCM, clipped, the format the player
/// takes (tts/format.rs).
pub fn to_pcm16le(samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for &s in samples {
        let v = (s.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pcm16_clips_and_is_little_endian() {
        let pcm = to_pcm16le(&[0.0, 1.0, -1.0, 2.0, 0.5]);
        assert_eq!(pcm.len(), 10);
        assert_eq!(i16::from_le_bytes([pcm[2], pcm[3]]), 32767);
        assert_eq!(i16::from_le_bytes([pcm[4], pcm[5]]), -32767);
        assert_eq!(i16::from_le_bytes([pcm[6], pcm[7]]), 32767);
        assert_eq!(i16::from_le_bytes([pcm[8], pcm[9]]), 16384);
    }
}
