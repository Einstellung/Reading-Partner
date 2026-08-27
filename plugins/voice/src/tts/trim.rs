// Cutting the silence off both ends of a sentence.
//
// Mimo leaves 117 ms of silence in front of a sentence and 451 ms behind it on
// average (docs/33, 实测). Played one sentence after another that tail is dead
// air between every pair — forty sentences is eighteen seconds of nothing.
//
// The trim is streaming rather than whole-sentence: the head is decided as soon
// as a loud enough window shows up, and the tail by holding back a fixed window
// of the most recent audio and never emitting it until the stream ends. So it
// costs no pass of its own and no buffer of its own beyond that window.
//
// It does not make the first sentence audible any sooner. The relay hands the
// player one finished sentence at a time (docs/33, `plugins/voice/README.md`),
// so the first sentence of an answer still waits for its own last byte —
// measured at 1560 ms on a real briefing. What removes that wait is the opening
// cache, not this; sub-sentence hand-off is the thing that would, and it is not
// what was built.

use std::collections::VecDeque;

use super::format::AudioFormat;

#[derive(Debug, Clone, Copy)]
pub struct TrimConfig {
    /// A window whose loudest sample is below this counts as silence.
    pub threshold_dbfs: f64,
    /// Analysis window. Small enough to place the cut precisely, large enough
    /// that a single stray sample does not decide it.
    pub window_ms: f64,
    /// Kept in front of the first loud window. Onset material really is down
    /// there: the windows immediately before the first one over the threshold
    /// measure -47 to -54 dBFS on the sentences that open with s- or k-.
    pub head_guard_ms: f64,
    /// Kept after the last loud window. This one is not a precaution, it is the
    /// difference between a sentence and a noise: with it at zero, "是。" — one
    /// syllable, all of it fricative — reads back as "Shi." instead of "是。",
    /// while the head guard at zero changes nothing. The coda is where a Chinese
    /// syllable's unvoiced energy trails off under the threshold.
    pub tail_guard_ms: f64,
    /// The most that will ever be cut off the front. Past this the head is left
    /// alone: a sentence that is quiet all the way through is a sentence, and
    /// deleting it is worse than leaving silence in front of it.
    pub max_head_trim_ms: f64,
    /// How much of the most recent audio is held back so that the tail can still
    /// be cut. Trailing silence longer than this is trimmed only down to this;
    /// nothing breaks, less is removed.
    pub tail_holdback_ms: f64,
}

impl Default for TrimConfig {
    fn default() -> Self {
        Self {
            threshold_dbfs: DEFAULT_THRESHOLD_DBFS,
            window_ms: 10.0,
            head_guard_ms: 40.0,
            tail_guard_ms: 60.0,
            max_head_trim_ms: 500.0,
            tail_holdback_ms: 900.0,
        }
    }
}

/// Set by measuring what Mimo actually sends, which is not what the word
/// "silence" suggests.
///
/// What sits in front of and behind a sentence is not digital zero: it is room
/// tone between -45 and -65 dBFS, sample by sample (sixteen sentences,
/// 10 ms windows, 2026-08-27). A threshold anywhere below -55 dBFS therefore
/// trims almost nothing — at -60 dBFS the mean tail cut is 39 ms against the
/// 451 ms that is actually there. -45 dBFS is the first threshold that removes
/// the tone consistently: mean head 60 ms, mean tail 355 ms.
///
/// It does not eat speech. Every one of the sixteen sentences reads back through
/// SenseVoiceSmall identically trimmed and untrimmed, including the ones chosen
/// for aspirated onsets and fricative codas.
const DEFAULT_THRESHOLD_DBFS: f64 = -45.0;

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct TrimReport {
    pub input_ms: f64,
    pub kept_ms: f64,
    pub head_trimmed_ms: f64,
    pub tail_trimmed_ms: f64,
    /// The head hit `max_head_trim_ms` without finding anything loud, so it was
    /// left alone.
    pub head_capped: bool,
}

enum Phase {
    /// Still looking for the first loud window.
    Head { buf: Vec<u8> },
    /// The head is decided; everything from here is held back by one window's
    /// worth of tail before it goes out.
    Body { hold: VecDeque<u8> },
}

pub struct SilenceTrimmer {
    format: AudioFormat,
    config: TrimConfig,
    phase: Phase,
    /// Bytes of a sample that arrived split across two reads.
    remainder: Vec<u8>,
    scanned: usize,
    /// Whether anything above the threshold was ever seen. False means this
    /// sentence was never analysable, and neither end of it is trimmed.
    found_onset: bool,
    report: TrimReport,
}

impl SilenceTrimmer {
    pub fn new(format: AudioFormat, config: TrimConfig) -> Self {
        assert_eq!(
            format.bits_per_sample, 16,
            "the trimmer reads signed 16-bit samples"
        );
        Self {
            format,
            config,
            phase: Phase::Head { buf: Vec::new() },
            remainder: Vec::new(),
            scanned: 0,
            found_onset: false,
            report: TrimReport::default(),
        }
    }

    /// Feed PCM as it arrives. Answers with the bytes that are safe to play now,
    /// which is everything except the tail still under consideration.
    pub fn push(&mut self, pcm: &[u8]) -> Vec<u8> {
        let bytes = self.align(pcm);
        if bytes.is_empty() {
            return Vec::new();
        }
        self.report.input_ms += self.format.duration_ms(bytes.len());

        match &mut self.phase {
            Phase::Head { buf } => {
                buf.extend_from_slice(&bytes);
                match self.find_onset() {
                    Some(keep_from) => {
                        let Phase::Head { buf } = &mut self.phase else {
                            unreachable!()
                        };
                        let kept = buf.split_off(keep_from);
                        self.report.head_trimmed_ms = self.format.duration_ms(keep_from);
                        self.phase = Phase::Body {
                            hold: VecDeque::from(kept),
                        };
                        self.drain_beyond_holdback()
                    }
                    None => Vec::new(),
                }
            }
            Phase::Body { hold } => {
                hold.extend(bytes.iter().copied());
                self.drain_beyond_holdback()
            }
        }
    }

    /// The stream is over. Answers with the held-back tail, minus its silence.
    pub fn finish(&mut self) -> Vec<u8> {
        if let Phase::Head { buf } = &mut self.phase {
            // Nothing loud ever showed up, or it showed up inside the last
            // window and was never scanned. Decide the head now on everything
            // there is, then fall through to the tail.
            let taken = std::mem::take(buf);
            let onset = onset_in(&taken, self.format, &self.config, 0);
            self.found_onset |= onset.is_some();
            let keep_from = onset.map(|(at, _)| at).unwrap_or(0);
            self.report.head_trimmed_ms = self.format.duration_ms(keep_from);
            self.phase = Phase::Body {
                hold: VecDeque::from(taken[keep_from..].to_vec()),
            };
        }

        let Phase::Body { hold } = &mut self.phase else {
            unreachable!()
        };
        let tail: Vec<u8> = std::mem::take(hold).into();
        // A sentence with nothing above the threshold anywhere is passed through
        // whole. Trimming it would mean deleting most of it on the strength of a
        // measurement that already said it could not be measured.
        let keep_to = if self.found_onset {
            last_loud_end(&tail, self.format, &self.config)
        } else {
            tail.len()
        };
        self.report.tail_trimmed_ms = self.format.duration_ms(tail.len() - keep_to);
        let out = tail[..keep_to].to_vec();
        self.report.kept_ms += self.format.duration_ms(out.len());
        out
    }

    pub fn report(&self) -> TrimReport {
        self.report
    }

    /// Hold on to a byte that arrived without its partner, so that a sample is
    /// never read across a chunk boundary as two halves of different samples.
    fn align(&mut self, pcm: &[u8]) -> Vec<u8> {
        let frame = self.format.bytes_per_frame();
        let mut bytes = std::mem::take(&mut self.remainder);
        bytes.extend_from_slice(pcm);
        let keep = bytes.len() % frame;
        if keep > 0 {
            self.remainder = bytes.split_off(bytes.len() - keep);
        }
        bytes
    }

    /// Where the kept audio starts, once something loud has been seen. `None`
    /// while the head is still all silence and still under the cap.
    fn find_onset(&mut self) -> Option<usize> {
        let Phase::Head { buf } = &self.phase else {
            return None;
        };
        if let Some((keep_from, scanned)) = onset_in(buf, self.format, &self.config, self.scanned) {
            self.scanned = scanned;
            self.found_onset = true;
            return Some(keep_from);
        }
        self.scanned = buf.len() - (buf.len() % window_bytes(self.format, &self.config));
        let cap = self.format.bytes_for_ms(self.config.max_head_trim_ms);
        if buf.len() > cap {
            self.report.head_capped = true;
            return Some(0);
        }
        None
    }

    fn drain_beyond_holdback(&mut self) -> Vec<u8> {
        let holdback = self.format.bytes_for_ms(self.config.tail_holdback_ms);
        let Phase::Body { hold } = &mut self.phase else {
            return Vec::new();
        };
        if hold.len() <= holdback {
            return Vec::new();
        }
        let take = hold.len() - holdback;
        let out: Vec<u8> = hold.drain(..take).collect();
        self.report.kept_ms += self.format.duration_ms(out.len());
        out
    }
}

fn window_bytes(format: AudioFormat, config: &TrimConfig) -> usize {
    format.bytes_for_ms(config.window_ms).max(format.bytes_per_frame())
}

fn threshold_amplitude(config: &TrimConfig) -> i32 {
    (10f64.powf(config.threshold_dbfs / 20.0) * 32768.0).round() as i32
}

fn window_peak(bytes: &[u8]) -> i32 {
    bytes
        .chunks_exact(2)
        .map(|s| (i16::from_le_bytes([s[0], s[1]]) as i32).abs())
        .max()
        .unwrap_or(0)
}

/// The first byte to keep, and how far the scan got. Windows before `from` have
/// already been looked at and were silent.
fn onset_in(
    buf: &[u8],
    format: AudioFormat,
    config: &TrimConfig,
    from: usize,
) -> Option<(usize, usize)> {
    let win = window_bytes(format, config);
    let threshold = threshold_amplitude(config);
    let mut at = from - (from % win);
    while at + win <= buf.len() {
        if window_peak(&buf[at..at + win]) > threshold {
            let guard = format.bytes_for_ms(config.head_guard_ms);
            return Some((at.saturating_sub(guard), at));
        }
        at += win;
    }
    None
}

/// One past the last byte worth keeping: the end of the last loud window plus
/// the release guard. Zero when the whole buffer is silence.
fn last_loud_end(buf: &[u8], format: AudioFormat, config: &TrimConfig) -> usize {
    let win = window_bytes(format, config);
    let threshold = threshold_amplitude(config);
    let mut end = buf.len() - (buf.len() % win);
    while end >= win {
        if window_peak(&buf[end - win..end]) > threshold {
            let guard = format.bytes_for_ms(config.tail_guard_ms);
            return (end + guard).min(buf.len());
        }
        end -= win;
    }
    0
}

/// `ms` of digital silence, for the pause the trim took out from between two
/// sentences.
pub fn silence(format: AudioFormat, ms: f64) -> Vec<u8> {
    vec![0u8; format.bytes_for_ms(ms)]
}

#[cfg(test)]
mod tests {
    use super::*;

    const F: AudioFormat = AudioFormat::PCM16_24K_MONO;

    fn tone(ms: f64, amplitude: i16) -> Vec<u8> {
        let samples = (ms / 1000.0 * F.sample_rate_hz as f64) as usize;
        (0..samples)
            .flat_map(|i| {
                let v = if i % 2 == 0 { amplitude } else { -amplitude };
                v.to_le_bytes()
            })
            .collect()
    }

    fn run(chunks: &[Vec<u8>], config: TrimConfig) -> (Vec<u8>, TrimReport) {
        let mut t = SilenceTrimmer::new(F, config);
        let mut out = Vec::new();
        for c in chunks {
            out.extend(t.push(c));
        }
        out.extend(t.finish());
        (out, t.report())
    }

    #[test]
    fn silence_is_cut_off_both_ends_and_the_speech_survives() {
        let mut pcm = tone(200.0, 0);
        pcm.extend(tone(1000.0, 8000));
        pcm.extend(tone(600.0, 0));
        let (out, report) = run(&[pcm], TrimConfig::default());
        let kept = F.duration_ms(out.len());
        // 1000 ms of tone, plus the two guards, and nothing else.
        assert!((kept - 1100.0).abs() < 25.0, "kept {kept} ms");
        assert!(report.head_trimmed_ms > 150.0, "{report:?}");
        assert!(report.tail_trimmed_ms > 500.0, "{report:?}");
    }

    #[test]
    fn the_answer_is_the_same_however_the_bytes_were_split() {
        let mut pcm = tone(200.0, 0);
        pcm.extend(tone(1000.0, 8000));
        pcm.extend(tone(600.0, 0));
        let whole = run(&[pcm.clone()], TrimConfig::default()).0;
        // 7681 is odd on purpose: a sample lands split across two pushes.
        let split: Vec<Vec<u8>> = pcm.chunks(7681).map(|c| c.to_vec()).collect();
        assert_eq!(run(&split, TrimConfig::default()).0, whole);
    }

    #[test]
    fn audio_is_emitted_before_the_stream_ends() {
        let mut t = SilenceTrimmer::new(F, TrimConfig::default());
        let mut emitted = 0;
        emitted += t.push(&tone(120.0, 0)).len();
        assert_eq!(emitted, 0, "nothing while the head is undecided");
        for _ in 0..10 {
            emitted += t.push(&tone(320.0, 8000)).len();
        }
        // Three seconds in, only the holdback is still being kept back.
        assert!(F.duration_ms(emitted) > 2000.0, "emitted {emitted} bytes");
    }

    #[test]
    fn a_sentence_that_is_quiet_all_through_is_left_alone_rather_than_deleted() {
        // Under the threshold everywhere: a real onset that never gets loud.
        let pcm = tone(1500.0, 4);
        let (out, report) = run(&[pcm.clone()], TrimConfig::default());
        assert!(report.head_capped);
        assert_eq!(report.head_trimmed_ms, 0.0);
        assert_eq!(out.len(), pcm.len());
    }

    #[test]
    fn trailing_silence_longer_than_the_holdback_is_trimmed_down_to_it() {
        let mut pcm = tone(500.0, 8000);
        pcm.extend(tone(3000.0, 0));
        let (out, _) = run(&[pcm], TrimConfig::default());
        let kept = F.duration_ms(out.len());
        // 500 ms of tone plus the guard, plus the silence that had already gone
        // out before the holdback could hold it back.
        assert!(kept < 2700.0, "kept {kept} ms");
        assert!(kept > 500.0, "kept {kept} ms");
    }

    #[test]
    fn the_head_guard_keeps_a_quiet_onset() {
        let mut pcm = tone(200.0, 0);
        // A 20 ms run below the threshold immediately before the loud part: an
        // aspirated onset. It has to survive.
        pcm.extend(tone(20.0, 20));
        pcm.extend(tone(500.0, 8000));
        let (out, _) = run(&[pcm], TrimConfig::default());
        let kept = F.duration_ms(out.len());
        assert!(kept >= 520.0, "kept {kept} ms, the onset was cut");
    }
}
