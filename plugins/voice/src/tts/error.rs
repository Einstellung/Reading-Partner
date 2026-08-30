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
            TtsError::Cancelled => write!(f, "speaking was stopped"),
        }
    }
}

impl std::error::Error for TtsError {}

/// What separates a refusal from a failure. Both vendors bury it one level down
/// and neither uses a status code of its own, so the body is the only thing to
/// go on. A list rather than an exact code because the two known vendors already
/// disagree — DashScope puts `DataInspectionFailed` at the top level, Mimo nests
/// an OpenAI-shaped `error` object — and a third will disagree again.
const MODERATION_MARKERS: &[&str] = &[
    "datainspectionfailed",
    "data_inspection_failed",
    "content_filter",
    "content_policy",
    "contentpolicy",
    "risk_control",
    "sensitive",
    "moderation",
    "内容安全",
    "内容审核",
    "违规",
];

/// Split a vendor error body into "refused" and "failed". `status` is `None`
/// when the error arrived inside an SSE frame rather than as a response status.
pub(crate) fn classify(status: Option<u16>, body: &str) -> TtsError {
    let (code, message) = extract_code_and_message(body);
    let haystack = format!(
        "{} {} {}",
        code.as_deref().unwrap_or(""),
        message.as_deref().unwrap_or(""),
        body
    )
    .to_lowercase();
    let moderated = MODERATION_MARKERS.iter().any(|m| haystack.contains(m));
    let message = message.unwrap_or_else(|| truncate(body, 300));
    if moderated {
        TtsError::Moderated { code, message }
    } else {
        match status {
            Some(status) => TtsError::Status {
                status,
                code,
                message,
            },
            None => TtsError::Protocol(message),
        }
    }
}

fn extract_code_and_message(body: &str) -> (Option<String>, Option<String>) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return (None, None);
    };
    let src = value.get("error").filter(|e| e.is_object()).unwrap_or(&value);
    let code = src
        .get("code")
        .or_else(|| src.get("type"))
        .and_then(json_as_string);
    let message = src.get("message").and_then(json_as_string);
    (code, message)
}

fn json_as_string(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_shaped_moderation_is_a_refusal() {
        let e = classify(
            Some(400),
            r#"{"error":{"code":"content_filter","message":"blocked","type":"invalid_request_error"}}"#,
        );
        assert!(matches!(e, TtsError::Moderated { .. }), "{e:?}");
        assert!(!e.is_retryable());
    }

    #[test]
    fn dashscope_shaped_moderation_is_a_refusal() {
        let e = classify(Some(400), r#"{"code":"DataInspectionFailed","message":"no"}"#);
        assert!(matches!(e, TtsError::Moderated { .. }), "{e:?}");
    }

    #[test]
    fn an_ordinary_bad_request_is_not_a_refusal() {
        let e = classify(
            Some(400),
            r#"{"error":{"code":"invalid_voice","message":"no such voice"}}"#,
        );
        match e {
            TtsError::Status { status, code, .. } => {
                assert_eq!(status, 400);
                assert_eq!(code.as_deref(), Some("invalid_voice"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_server_error_is_worth_a_second_try_and_a_client_error_is_not() {
        assert!(classify(Some(503), "{}").is_retryable());
        assert!(classify(Some(429), "{}").is_retryable());
        assert!(!classify(Some(401), "{}").is_retryable());
    }

    #[test]
    fn an_answer_with_no_audio_in_it_is_worth_another_try() {
        assert!(TtsError::NoAudio.is_retryable());
    }

    #[test]
    fn a_body_that_is_not_json_still_produces_a_sentence() {
        let e = classify(Some(502), "<html>bad gateway</html>");
        assert!(e.to_string().contains("502"), "{e}");
    }
}
