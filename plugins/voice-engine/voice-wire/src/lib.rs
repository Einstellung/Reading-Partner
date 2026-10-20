// The socket between the main process and the Android voice engine
// (docs/companion/89): a 4-byte little-endian length, a 1-byte type, then the
// body; control messages are JSON, PCM is raw 16-bit little-endian samples.
// Depends on serde only, so the plugin can link it without the engine. The
// message types come with the socket; the payloads the engine already
// produces are here: the `conversation` and `speech` events and the
// playback's answers.

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
}
