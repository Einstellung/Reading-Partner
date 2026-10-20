// The socket between the main process and the Android voice engine
// (docs/companion/89): a 4-byte little-endian length, a 1-byte type, then the
// body; control messages are JSON, PCM is raw 16-bit little-endian samples.
// Depends on serde only, so the plugin can link it without the engine; both
// ends turn the messages into JSON with serde_json themselves.
//
// A message that carries audio (`Enqueue` one way, `Pcm` the other) is a
// CONTROL frame followed at once by a PCM frame, written together.

use std::io::{self, Read, Write};

use serde::{Deserialize, Serialize};

/// A frame longer than this closes the connection.
pub const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;

/// The `conversation` event's payload, field for field what
/// ConversationRun.swift's `ConversationEvent` encodes: one struct for every
/// kind, the fields a kind does not carry left `None` and so absent on the
/// wire (src/soul/voice/conversation.ts reads them).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationEvent {
    pub kind: String,
    /// The user turn this belongs to: the last one taken, from 1; 0 before any.
    pub turn: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub silent_ms: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub running: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub utterance: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cut: Option<SpeechCut>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range: Option<SpeechRange>,
    /// The `envelope` kind's four: the sentence's index within the turn, how
    /// long after this event it is heard, what one value covers, the values.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sentence: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub starts_in_ms: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_ms: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub values: Option<Vec<f64>>,
}

impl ConversationEvent {
    pub fn new(kind: &str, turn: u64) -> Self {
        Self { kind: kind.to_string(), turn, ..Self::default() }
    }
}

/// Where a barge-in cut the companion off (`SpeechCut` in Swift).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechCut {
    pub utterance: u64,
    pub sentence: i64,
    pub char_offset: i64,
    pub played_ms: f64,
}

/// The span of the call's audio a recogniser result covers.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechRange {
    pub start_ms: f64,
    pub end_ms: f64,
}

/// The playback path's own `speech` event (VoicePlugin.swift `emitSpeech`):
/// `speaking` 1/0 with the reason it stopped, and the output `level`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpeechEvent {
    pub kind: String,
    pub value: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Where the voice is: the answer to `StopSpeaking` (`SpeechPosition`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechPosition {
    pub speaking: bool,
    pub utterance: u64,
    /// The sentence being spoken, or -1 when nothing was.
    pub index: i64,
    pub char_offset: i64,
    pub played_ms: f64,
}

/// The answer to `Enqueue` (`SpeechAck` in Swift, `SpeechEnqueued` in the
/// plugin).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechEnqueued {
    pub dropped: bool,
    #[serde(default)]
    pub busy: bool,
    pub queued_ms: f64,
    pub start_ms: f64,
}

/// When a sentence passed the main process's stages (`SentenceMarks`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceMarks {
    pub requested_ms: f64,
    pub first_audio_ms: f64,
    pub handed_ms: f64,
}

// --- Frames -------------------------------------------------------------------

/// A JSON `ToEngine` or `ToMain`.
pub const CONTROL: u8 = 1;
/// Raw 16-bit little-endian mono samples for the control frame just before it.
pub const PCM: u8 = 2;

fn too_long(len: usize) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, format!("a {len}-byte frame is over the {MAX_FRAME_BYTES}-byte limit"))
}

/// Append one frame to `out`. The length counts the body, not the type byte.
pub fn put_frame(out: &mut Vec<u8>, kind: u8, body: &[u8]) -> io::Result<()> {
    if body.len() > MAX_FRAME_BYTES {
        return Err(too_long(body.len()));
    }
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.push(kind);
    out.extend_from_slice(body);
    Ok(())
}

/// A control message and, for the two that carry audio, its samples: the
/// bytes to write in one go.
pub fn message(json: &[u8], pcm: Option<&[u8]>) -> io::Result<Vec<u8>> {
    let mut out = Vec::with_capacity(json.len() + pcm.map_or(0, |p| p.len() + 5) + 5);
    put_frame(&mut out, CONTROL, json)?;
    if let Some(pcm) = pcm {
        put_frame(&mut out, PCM, pcm)?;
    }
    Ok(out)
}

/// The next frame, or None when the stream ended between frames. A frame
/// over the limit is an error: the caller drops the connection.
pub fn read_frame(r: &mut impl Read) -> io::Result<Option<(u8, Vec<u8>)>> {
    let mut head = [0u8; 5];
    let mut got = 0;
    while got < head.len() {
        match r.read(&mut head[got..]) {
            Ok(0) if got == 0 => return Ok(None),
            Ok(0) => return Err(io::ErrorKind::UnexpectedEof.into()),
            Ok(n) => got += n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(e) => return Err(e),
        }
    }
    let len = u32::from_le_bytes([head[0], head[1], head[2], head[3]]) as usize;
    if len > MAX_FRAME_BYTES {
        return Err(too_long(len));
    }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body)?;
    Ok(Some((head[4], body)))
}

pub fn write_frames(w: &mut impl Write, bytes: &[u8]) -> io::Result<()> {
    w.write_all(bytes)?;
    w.flush()
}

pub fn pcm_bytes(samples: &[i16]) -> Vec<u8> {
    samples.iter().flat_map(|s| s.to_le_bytes()).collect()
}

pub fn pcm_samples(bytes: &[u8]) -> io::Result<Vec<i16>> {
    if bytes.len() % 2 != 0 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "PCM of an odd length"));
    }
    Ok(bytes.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect())
}

// --- Messages -----------------------------------------------------------------

/// Every file `Open` has the engine load, as absolute paths.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFiles {
    pub silero: String,
    pub smart_turn: String,
    pub asr_model: String,
    pub asr_mmproj: String,
    pub kokoro_model: String,
}

/// Threads per model; Silero always runs on one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Threads {
    pub smart_turn: u32,
    pub asr: u32,
    pub kokoro: u32,
}

impl Default for Threads {
    fn default() -> Self {
        Self { smart_turn: 2, asr: 4, kokoro: 4 }
    }
}

/// Main process to engine. Every request carries an `id` its answer repeats.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ToEngine {
    /// Load what is not loaded and start a call: `Done` or `Error`.
    Open { id: u64, files: ModelFiles, threads: Threads },
    /// Hang up and let the microphone go; the models stay. `Done`.
    Close { id: u64 },
    /// One phoneme string through Kokoro (`model`, loaded here if no `Open`
    /// has loaded it yet) with the sentence's style row: `Pcm` or `Error`.
    Synthesize { id: u64, model: String, phonemes: String, style: Vec<f32>, speed: f32 },
    /// `Voice::enqueue_speech`, its 24 kHz samples in the PCM frame that
    /// follows: `Enqueued` or `Error`.
    Enqueue {
        id: u64,
        utterance: u64,
        index: u32,
        chars: u32,
        last: bool,
        part: u32,
        complete: bool,
        sample_rate: u32,
        marks: SentenceMarks,
    },
    /// `Voice::finish_speech`: `Done`.
    Finish { id: u64, utterance: u64 },
    /// `Voice::set_speech_volume`: `Done`.
    SetVolume { id: u64, value: f64 },
    /// `Voice::stop_speaking`: `Position`.
    StopSpeaking { id: u64, reason: String },
}

impl ToEngine {
    pub fn has_pcm(&self) -> bool {
        matches!(self, ToEngine::Enqueue { .. })
    }
}

/// Engine to main process: the two events and the answers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ToMain {
    /// The `conversation` event, for the listeners as it is.
    Event { event: ConversationEvent },
    /// The `speech` event.
    Speech { event: SpeechEvent },
    Done { id: u64 },
    /// The samples are in the PCM frame that follows.
    Pcm { id: u64 },
    Enqueued { id: u64, ack: SpeechEnqueued },
    Position { id: u64, position: SpeechPosition },
    Error { id: u64, message: String },
}

impl ToMain {
    pub fn has_pcm(&self) -> bool {
        matches!(self, ToMain::Pcm { .. })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, to_value};

    // The shapes src/soul/voice/conversation.ts reads, as ConversationRun.swift
    // sends them: only the kind's own fields on the wire.
    #[test]
    fn conversation_events_carry_only_their_kind_s_fields() {
        let mut stop = ConversationEvent::new("speech-stop", 2);
        stop.cut = Some(SpeechCut { utterance: 1, sentence: 1, char_offset: 16, played_ms: 2600.0 });
        assert_eq!(
            to_value(&stop).unwrap(),
            json!({"kind": "speech-stop", "turn": 2, "cut": {"utterance": 1, "sentence": 1, "charOffset": 16, "playedMs": 2600.0}})
        );
        let mut end = ConversationEvent::new("speech-end", 2);
        end.text = Some(String::new());
        end.silent_ms = Some(288.0);
        assert_eq!(to_value(&end).unwrap(), json!({"kind": "speech-end", "turn": 2, "text": "", "silentMs": 288.0}));
        let mut env = ConversationEvent::new("envelope", 0);
        env.utterance = Some(3);
        env.sentence = Some(0);
        env.starts_in_ms = Some(40.0);
        env.window_ms = Some(25.0);
        env.values = Some(vec![0.5, 1.0]);
        assert_eq!(
            to_value(&env).unwrap(),
            json!({"kind": "envelope", "turn": 0, "utterance": 3, "sentence": 0, "startsInMs": 40.0, "windowMs": 25.0, "values": [0.5, 1.0]})
        );
        let mut state = ConversationEvent::new("state", 0);
        state.running = Some(false);
        state.reason = Some("failed".into());
        assert_eq!(to_value(&state).unwrap(), json!({"kind": "state", "turn": 0, "running": false, "reason": "failed"}));
        let back: ConversationEvent = serde_json::from_value(to_value(&stop).unwrap()).unwrap();
        assert_eq!(back, stop);
    }

    #[test]
    fn the_playback_answers_round_trip() {
        let speaking = SpeechEvent { kind: "speaking".into(), value: 0.0, reason: Some("interrupted".into()) };
        assert_eq!(to_value(&speaking).unwrap(), json!({"kind": "speaking", "value": 0.0, "reason": "interrupted"}));
        let level = SpeechEvent { kind: "level".into(), value: 0.5, reason: None };
        assert_eq!(to_value(&level).unwrap(), json!({"kind": "level", "value": 0.5}));
        let at = SpeechPosition { speaking: true, utterance: 4, index: 1, char_offset: 3, played_ms: 120.0 };
        assert_eq!(
            to_value(at).unwrap(),
            json!({"speaking": true, "utterance": 4, "index": 1, "charOffset": 3, "playedMs": 120.0})
        );
        let ack: SpeechEnqueued =
            serde_json::from_value(json!({"dropped": false, "queuedMs": 80.0, "startMs": 0.0})).unwrap();
        assert!(!ack.busy && ack.queued_ms == 80.0);
        let marks = SentenceMarks { requested_ms: 1.0, first_audio_ms: 2.0, handed_ms: 3.0 };
        assert_eq!(to_value(marks).unwrap(), json!({"requestedMs": 1.0, "firstAudioMs": 2.0, "handedMs": 3.0}));
    }

    #[test]
    fn frames_round_trip_and_end_cleanly() {
        let bytes = message(br#"{"type":"pcm","id":3}"#, Some(&pcm_bytes(&[1, -2, 32767]))).unwrap();
        let mut r = &bytes[..];
        let (kind, body) = read_frame(&mut r).unwrap().unwrap();
        assert_eq!((kind, &body[..]), (CONTROL, &br#"{"type":"pcm","id":3}"#[..]));
        let (kind, body) = read_frame(&mut r).unwrap().unwrap();
        assert_eq!(kind, PCM);
        assert_eq!(pcm_samples(&body).unwrap(), [1, -2, 32767]);
        assert!(read_frame(&mut r).unwrap().is_none());
        // Cut inside a frame is an error, not an end.
        assert!(read_frame(&mut &bytes[..7]).is_err());
    }

    #[test]
    fn a_frame_over_the_limit_is_refused_both_ways() {
        assert!(message(&vec![0; MAX_FRAME_BYTES + 1], None).is_err());
        let mut head = ((MAX_FRAME_BYTES + 1) as u32).to_le_bytes().to_vec();
        head.push(CONTROL);
        assert_eq!(read_frame(&mut &head[..]).unwrap_err().kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn messages_are_tagged_camel_case() {
        let open = ToEngine::Open {
            id: 1,
            files: ModelFiles {
                silero: "/m/s".into(),
                smart_turn: "/m/t".into(),
                asr_model: "/m/a".into(),
                asr_mmproj: "/m/p".into(),
                kokoro_model: "/m/k".into(),
            },
            threads: Threads::default(),
        };
        assert_eq!(
            to_value(&open).unwrap(),
            json!({"type": "open", "id": 1,
                   "files": {"silero": "/m/s", "smartTurn": "/m/t", "asrModel": "/m/a", "asrMmproj": "/m/p", "kokoroModel": "/m/k"},
                   "threads": {"smartTurn": 2, "asr": 4, "kokoro": 4}})
        );
        let stop = ToEngine::StopSpeaking { id: 9, reason: "interrupted".into() };
        assert_eq!(to_value(&stop).unwrap(), json!({"type": "stopSpeaking", "id": 9, "reason": "interrupted"}));
        let enq: ToEngine = serde_json::from_value(json!({"type": "enqueue", "id": 2, "utterance": 1, "index": 0,
            "chars": 4, "last": true, "part": 0, "complete": true, "sampleRate": 24000,
            "marks": {"requestedMs": 1.0, "firstAudioMs": 2.0, "handedMs": 3.0}})).unwrap();
        assert!(enq.has_pcm());
        let style: Vec<f32> = (0..256).map(|i| (i as f32 * 0.37).sin() / 7.0).collect();
        let synth = ToEngine::Synthesize { id: 4, model: "/m/k".into(), phonemes: "ni2".into(), style, speed: 1.1 };
        let back: ToEngine = serde_json::from_slice(&serde_json::to_vec(&synth).unwrap()).unwrap();
        assert_eq!(back, synth, "f32 style rows survive JSON exactly");
        let err = ToMain::Error { id: 4, message: "no".into() };
        assert_eq!(to_value(&err).unwrap(), json!({"type": "error", "id": 4, "message": "no"}));
        assert!(ToMain::Pcm { id: 4 }.has_pcm() && !err.has_pcm());
    }
}
