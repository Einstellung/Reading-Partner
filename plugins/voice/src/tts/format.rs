// The one audio layout this whole path speaks: raw interleaved PCM, no
// container. Every backend decodes whatever the wire gives it down to this,
// because the thing at the far end is an AVAudioPlayerNode buffer and not a
// decoder (docs/33, 形态：全原生).

/// Sample layout of a backend's output.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioFormat {
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub bits_per_sample: u16,
}

impl AudioFormat {
    /// Mimo and Qwen3-TTS both deliver this and neither lets the caller pick, so
    /// it is a constant rather than a request parameter. It is also absent from
    /// the response: the rate was arrived at by cross-checking per-sentence
    /// durations against the two vendors that document 24 kHz (docs/33, TTS).
    pub const PCM16_24K_MONO: AudioFormat = AudioFormat {
        sample_rate_hz: 24_000,
        channels: 1,
        bits_per_sample: 16,
    };

    pub const fn bytes_per_frame(self) -> usize {
        (self.bits_per_sample as usize / 8) * self.channels as usize
    }

    pub const fn bytes_per_second(self) -> usize {
        self.bytes_per_frame() * self.sample_rate_hz as usize
    }

    pub fn duration_ms(self, bytes: usize) -> f64 {
        bytes as f64 * 1000.0 / self.bytes_per_second() as f64
    }

    /// Rounded down to a whole frame, so the answer is always a legal split
    /// point in a PCM stream.
    pub fn bytes_for_ms(self, ms: f64) -> usize {
        let raw = (ms / 1000.0 * self.bytes_per_second() as f64).max(0.0) as usize;
        raw - (raw % self.bytes_per_frame())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_second_of_pcm16_24k_mono_is_48000_bytes() {
        let f = AudioFormat::PCM16_24K_MONO;
        assert_eq!(f.bytes_per_second(), 48_000);
        assert_eq!(f.duration_ms(48_000), 1000.0);
        assert_eq!(f.bytes_for_ms(1000.0), 48_000);
    }

    #[test]
    fn byte_counts_land_on_frame_boundaries() {
        let f = AudioFormat::PCM16_24K_MONO;
        // 0.1 ms is 2.4 samples; a split there has to fall on a whole sample or
        // the two halves swap their bytes' meaning.
        assert_eq!(f.bytes_for_ms(0.1) % f.bytes_per_frame(), 0);
    }
}
