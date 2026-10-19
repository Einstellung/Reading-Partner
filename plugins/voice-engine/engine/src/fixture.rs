// Test fixtures for the listening half. `fixtures/` holds a clip Kokoro said on
// Linux, resampled to 16 kHz, and the reference values the official Python
// implementations gave for it (`fixtures/make_fixture.py`). Real models come
// from `VOICE_MODELS`, a directory laid out like the download directory; a
// test that needs one returns early when it is not there.

use std::path::PathBuf;

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

/// The fixture clip as floats in [-1, 1).
pub fn clip() -> Vec<f32> {
    let bytes = std::fs::read(dir().join("clip.wav")).unwrap();
    // A canonical 44-byte header: RIFF, fmt (PCM, mono, 16 kHz, 16 bit), data.
    assert_eq!(&bytes[..4], b"RIFF");
    assert_eq!(&bytes[36..40], b"data");
    assert_eq!(u16::from_le_bytes([bytes[22], bytes[23]]), 1);
    assert_eq!(u32::from_le_bytes(bytes[24..28].try_into().unwrap()), 16_000);
    assert_eq!(u16::from_le_bytes([bytes[34], bytes[35]]), 16);
    let len = u32::from_le_bytes(bytes[40..44].try_into().unwrap()) as usize;
    bytes[44..44 + len]
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
        .collect()
}

pub fn reference() -> serde_json::Value {
    serde_json::from_slice(&std::fs::read(dir().join("reference.json")).unwrap()).unwrap()
}

/// A little-endian f32 file in `fixtures/`.
pub fn f32s(name: &str) -> Vec<f32> {
    std::fs::read(dir().join(name))
        .unwrap()
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
        .collect()
}

/// `VOICE_MODELS/<file>`, or None (and a note on stdout) when it is not there.
pub fn model(file: &str) -> Option<PathBuf> {
    let Some(dir) = std::env::var_os("VOICE_MODELS") else {
        println!("skipped: VOICE_MODELS is not set");
        return None;
    };
    let path = PathBuf::from(dir).join(file);
    if path.is_file() {
        Some(path)
    } else {
        println!("skipped: no {}", path.display());
        None
    }
}
