// One error type for the whole synthesis path. The split that matters is
// between what is worth trying again and what is not: a connection that was
// never made is worth a second try (2 sentences out of 40 failed exactly that
// way in the first bench, docs/33), a sentence the vendor refused to say is not.

use std::fmt;

#[derive(Debug)]
pub enum TtsError {
    /// The request never completed at the transport level.
    Transport {
        /// True while nothing of the response body has arrived. Only these are
        /// retried: once PCM has been handed on, a retry would speak the head of
        /// the sentence twice.
        before_first_byte: bool,
        message: String,
    },
    /// A non-2xx answer that is not moderation.
    Status {
        status: u16,
        code: Option<String>,
        message: String,
    },
    /// The vendor refused the text, or the audio it made from it. Never retried
    /// and never reported as a network problem — the same sentence will be
    /// refused again.
    Moderated {
        code: Option<String>,
        message: String,
    },
    /// Well-formed HTTP, unusable body: an SSE frame that is not JSON, base64
    /// that will not decode.
    Protocol(String),
    /// A 200 that ran its whole stream and never carried a sample. Seen twice in
    /// about thirty requests and not reproducible on the same text a minute
    /// later, so it is transient and worth one more try rather than a sentence
    /// dropped from the middle of an answer.
    NoAudio,
    /// The far end refused the audio, or could not be reached at all: a host
    /// with no player, an engine that is not running, a sample rate the node is
    /// not wired for. Never retried — the same bytes would be refused again.
    Player(String),
    /// The on-device engine could not load its files or run a sentence
    /// (tts/kokoro.rs). Never retried: the same files give the same answer.
    Engine(String),
    /// The session was stopped: barge-in, or the turn was abandoned.
    Cancelled,
    /// The player would not take the sentence yet because it is still speaking
    /// an earlier turn. Nothing is wrong with the sentence and nothing is wrong
    /// with the turn: the same bytes are taken once that tail runs out.
    /// `tail_ms` is how much of it the player says is left.
    Busy { tail_ms: f64 },
}

impl TtsError {
    pub fn is_retryable(&self) -> bool {
        match self {
            TtsError::Transport {
                before_first_byte, ..
            } => *before_first_byte,
            // 429 and 5xx are the server asking for a second try; other 4xx are
            // the request itself being wrong, and it will be wrong again.
            TtsError::Status { status, .. } => *status == 429 || *status >= 500,
            TtsError::NoAudio => true,
            // Tried again by the relay and not by the synthesis loop: it is the
            // hand-over that was refused, and the audio is already in hand.
            TtsError::Busy { .. } => false,
            _ => false,
        }
    }
}

impl fmt::Display for TtsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TtsError::Transport { message, .. } => {
                write!(f, "the voice service could not be reached: {message}")
            }
            TtsError::Status {
                status,
                code,
                message,
            } => match code {
                Some(code) => write!(f, "the voice service answered {status} {code}: {message}"),
                None => write!(f, "the voice service answered {status}: {message}"),
            },
            TtsError::Moderated { message, .. } => {
                write!(f, "the voice service refused to say this: {message}")
            }
            TtsError::Busy { tail_ms } => write!(
                f,
                "the player is still finishing the turn before this one,                  with {tail_ms:.0} ms of it left"
            ),
            TtsError::Protocol(what) => {
                write!(f, "the voice service sent something unreadable: {what}")
            }
            TtsError::NoAudio => write!(f, "the voice service answered without any audio"),
            // Verbatim: what the player rejects with is already a sentence
            // (VoicePlugin rejects with one), and a prefix would say it twice.
            TtsError::Player(what) => write!(f, "{what}"),
            TtsError::Engine(what) => write!(f, "the on-device voice failed: {what}"),
            TtsError::Cancelled => write!(f, "speaking was stopped"),
        }
    }
}

impl std::error::Error for TtsError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_server_error_is_worth_a_second_try_and_a_client_error_is_not() {
        let status = |status| TtsError::Status { status, code: None, message: String::new() };
        assert!(status(503).is_retryable());
        assert!(status(429).is_retryable());
        assert!(!status(400).is_retryable());
    }

    #[test]
    fn an_answer_with_no_audio_in_it_is_worth_another_try() {
        assert!(TtsError::NoAudio.is_retryable());
        assert!(!TtsError::Engine("no model".into()).is_retryable());
    }
}
