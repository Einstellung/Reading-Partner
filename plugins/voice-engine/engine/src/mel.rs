// The Whisper log-mel spectrogram Smart Turn was trained on (docs/companion/89),
// computed the way transformers' `WhisperFeatureExtractor` does it: a periodic
// Hann window of 400, hop 160, centred frames with reflect padding, the power
// spectrum through 80 Slaney-normalised mel filters on the Slaney mel scale
// (0-8000 Hz), log10 floored at 1e-10, the last frame dropped, everything
// clamped to 8 below the maximum, then (x + 4) / 4. In f64 throughout; the
// output is f32, mel-major: `[N_MELS][frames]`.

use std::sync::Arc;

use realfft::{RealFftPlanner, RealToComplex};

pub const N_FFT: usize = 400;
pub const HOP: usize = 160;
pub const N_MELS: usize = 80;
const BINS: usize = N_FFT / 2 + 1;
const SAMPLE_RATE: f64 = 16_000.0;

pub struct LogMel {
    fft: Arc<dyn RealToComplex<f64>>,
    window: Vec<f64>,
    /// `[N_MELS][BINS]`.
    filters: Vec<f64>,
}

impl Default for LogMel {
    fn default() -> Self {
        Self::new()
    }
}

/// Slaney's mel scale: linear below 1 kHz, logarithmic above.
fn hz_to_mel(hz: f64) -> f64 {
    let logstep = 27.0 / 6.4f64.ln();
    if hz >= 1000.0 {
        15.0 + (hz / 1000.0).ln() * logstep
    } else {
        3.0 * hz / 200.0
    }
}

fn mel_to_hz(mel: f64) -> f64 {
    if mel >= 15.0 {
        1000.0 * (6.4f64.ln() / 27.0 * (mel - 15.0)).exp()
    } else {
        200.0 * mel / 3.0
    }
}

/// transformers' `mel_filter_bank(201, 80, 0, 8000, 16000, "slaney", "slaney")`.
fn filter_bank() -> Vec<f64> {
    let (lo, hi) = (hz_to_mel(0.0), hz_to_mel(SAMPLE_RATE / 2.0));
    let edges: Vec<f64> = (0..N_MELS + 2)
        .map(|i| mel_to_hz(lo + (hi - lo) * i as f64 / (N_MELS + 1) as f64))
        .collect();
    let mut filters = vec![0.0; N_MELS * BINS];
    for m in 0..N_MELS {
        let enorm = 2.0 / (edges[m + 2] - edges[m]);
        for b in 0..BINS {
            let f = (SAMPLE_RATE / 2.0) * b as f64 / (BINS - 1) as f64;
            let down = (f - edges[m]) / (edges[m + 1] - edges[m]);
            let up = (edges[m + 2] - f) / (edges[m + 2] - edges[m + 1]);
            filters[m * BINS + b] = down.min(up).max(0.0) * enorm;
        }
    }
    filters
}

impl LogMel {
    pub fn new() -> Self {
        let fft = RealFftPlanner::<f64>::new().plan_fft_forward(N_FFT);
        let window = (0..N_FFT)
            .map(|n| 0.5 - 0.5 * (2.0 * std::f64::consts::PI * n as f64 / N_FFT as f64).cos())
            .collect();
        Self { fft, window, filters: filter_bank() }
    }

    /// How many frames `compute` returns for `samples` samples.
    pub fn frames(samples: usize) -> usize {
        samples / HOP
    }

    /// The log-mel of `samples` (16 kHz): `N_MELS * frames(samples.len())`
    /// values, mel-major. Needs more than `N_FFT / 2` samples for the reflect
    /// padding; fewer gives an empty result.
    pub fn compute(&self, samples: &[f32]) -> Vec<f32> {
        let n = samples.len();
        let frames = Self::frames(n);
        let pad = N_FFT / 2;
        if frames == 0 || n <= pad {
            return Vec::new();
        }
        // Reflect padding, numpy's "reflect": the edge sample is not repeated.
        let at = |i: isize| -> f64 {
            let len = n as isize;
            let j = if i < 0 {
                -i
            } else if i >= len {
                2 * (len - 1) - i
            } else {
                i
            };
            samples[j as usize] as f64
        };
        let mut input = self.fft.make_input_vec();
        let mut spectrum = self.fft.make_output_vec();
        let mut scratch = self.fft.make_scratch_vec();
        let mut power = vec![0.0f64; BINS];
        let mut out = vec![0.0f64; N_MELS * frames];
        for t in 0..frames {
            let start = (t * HOP) as isize - pad as isize;
            for (k, x) in input.iter_mut().enumerate() {
                *x = at(start + k as isize) * self.window[k];
            }
            self.fft
                .process_with_scratch(&mut input, &mut spectrum, &mut scratch)
                .expect("fft lengths are fixed");
            for (p, c) in power.iter_mut().zip(&spectrum) {
                *p = c.norm_sqr();
            }
            for m in 0..N_MELS {
                let row = &self.filters[m * BINS..(m + 1) * BINS];
                let e: f64 = row.iter().zip(&power).map(|(w, p)| w * p).sum();
                out[m * frames + t] = e.max(1e-10).log10();
            }
        }
        let floor = out.iter().cloned().fold(f64::NEG_INFINITY, f64::max) - 8.0;
        out.into_iter().map(|v| ((v.max(floor) + 4.0) / 4.0) as f32).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eight_seconds_is_eighty_by_eight_hundred() {
        let mel = LogMel::new();
        assert_eq!(LogMel::frames(128_000), 800);
        let out = mel.compute(&vec![0.0; 128_000]);
        assert_eq!(out.len(), N_MELS * 800);
        // Silence is the floor everywhere: log10(1e-10) = -10, (−10 + 4) / 4.
        assert!(out.iter().all(|&v| (v - -1.5).abs() < 1e-6));
        assert!(mel.compute(&[0.0; 100]).is_empty());
    }

    #[test]
    fn the_filters_are_slaney_normalised_triangles() {
        let f = filter_bank();
        for m in 0..N_MELS {
            let row = &f[m * BINS..(m + 1) * BINS];
            assert!(row.iter().all(|&w| w >= 0.0));
            assert!(row.iter().any(|&w| w > 0.0), "filter {m} is empty");
        }
        // The Slaney scale's corner: 1 kHz is mel 15 from either side.
        assert!((hz_to_mel(1000.0) - 15.0).abs() < 1e-12);
        assert!((mel_to_hz(hz_to_mel(3210.0)) - 3210.0).abs() < 1e-9);
    }
}
