// A Kokoro voice: 510 style vectors of 256 floats, one per phoneme count. The
// ONNX export ships each as raw little-endian f32 (`voices/<name>.bin`, the
// same numbers as the `.pt` tensor of shape [510, 1, 256]).

use std::path::Path;

use super::tokens::phoneme_len;

pub const STYLE_DIM: usize = 256;
pub const ROWS: usize = 510;
pub const BYTES: usize = ROWS * STYLE_DIM * 4;

pub struct VoicePack {
    data: Vec<f32>,
}

impl VoicePack {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() != BYTES {
            return Err(format!(
                "A Kokoro voice is {BYTES} bytes; this one is {}.",
                bytes.len()
            ));
        }
        let data = bytes
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();
        Ok(Self { data })
    }

    pub fn load(path: &Path) -> Result<Self, String> {
        let bytes =
            std::fs::read(path).map_err(|e| format!("Reading {}: {e}", path.display()))?;
        Self::from_bytes(&bytes)
    }

    /// The style for this phoneme string: `pack[len(ps) - 1]` in
    /// `KPipeline.infer`, the length counted in chars before the tokenizer
    /// drops anything.
    pub fn style_for(&self, phonemes: &str) -> &[f32] {
        let row = phoneme_len(phonemes).clamp(1, ROWS) - 1;
        &self.data[row * STYLE_DIM..(row + 1) * STYLE_DIM]
    }
}

/// The speed the official Chinese sample (samples/make_zh.py in
/// hexgrad/Kokoro-82M-v1.1-zh) uses: long sentences slower, everything 10%
/// faster. English voices run at 1.0.
pub fn zh_speed(phoneme_len: usize) -> f32 {
    let n = phoneme_len as f32;
    let speed = if phoneme_len <= 83 {
        1.0
    } else if phoneme_len < 183 {
        1.0 - (n - 83.0) / 500.0
    } else {
        0.8
    };
    speed * 1.1
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pack() -> VoicePack {
        let mut bytes = Vec::with_capacity(BYTES);
        for row in 0..ROWS {
            for col in 0..STYLE_DIM {
                bytes.extend_from_slice(&((row * 1000 + col) as f32).to_le_bytes());
            }
        }
        VoicePack::from_bytes(&bytes).unwrap()
    }

    #[test]
    fn style_row_is_phoneme_count_minus_one() {
        let p = pack();
        assert_eq!(p.style_for("a")[0], 0.0);
        assert_eq!(p.style_for("ㄋㄧ2")[0], 2000.0);
        assert_eq!(p.style_for("ㄋㄧ2")[255], 2255.0);
        assert_eq!(p.style_for("")[0], 0.0);
        assert_eq!(p.style_for(&"a".repeat(600))[0], 509_000.0);
    }

    #[test]
    fn wrong_size_is_refused() {
        assert!(VoicePack::from_bytes(&[0u8; 16]).is_err());
    }

    #[test]
    fn zh_speed_follows_the_sample() {
        assert!((zh_speed(48) - 1.1).abs() < 1e-6);
        assert!((zh_speed(109) - (1.0 - 26.0 / 500.0) * 1.1).abs() < 1e-6);
        assert!((zh_speed(186) - 0.88).abs() < 1e-6);
    }
}
