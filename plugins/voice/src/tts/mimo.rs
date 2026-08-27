// Xiaomi MiMo, `mimo-v2.5-tts`. Chosen on voice quality and pronunciation
// (docs/33, 实测); free for now with no published end date, which is why it sits
// behind TtsBackend rather than being the only thing here.
//
// It is OpenAI-shaped but not an OpenAI speech endpoint: the request goes to
// `/v1/chat/completions`, the text to speak goes in an *assistant* message, and
// the audio comes back as base64 PCM inside `choices[0].delta.audio.data`. A
// user message would be read as a style instruction and never spoken.

use std::time::Duration;

use async_trait::async_trait;
use base64::Engine as _;
use serde_json::json;
use tokio::sync::mpsc;

use super::backend::{SpeechRequest, TtsBackend};
use super::error::{classify, TtsError};
use super::format::AudioFormat;
use super::sse::{SseEvent, SseParser};

pub const DEFAULT_ENDPOINT: &str = "https://api.xiaomimimo.com/v1/chat/completions";
pub const DEFAULT_MODEL: &str = "mimo-v2.5-tts";
/// 冰糖 / 茉莉 / 苏打 / 白桦 are the four Chinese voices; 冰糖 is the one chosen
/// in the loudness-matched A/B (docs/33, 实测).
pub const DEFAULT_VOICE: &str = "冰糖";

/// Long enough to cover a handshake to a healthy server, short enough that a
/// connection that is not going to happen costs a retry instead of a stall. The
/// direct-route handshake measures 75-90 ms (docs/pitfall/186); the number below
/// is set from the connect-stage measurements in docs/assets/tts-probe.
const CONNECT_TIMEOUT: Duration = Duration::from_millis(2500);

/// Applies to each read off the response body, not to the request as a whole:
/// the whole point of the stream is that it lasts, and a per-read limit is what
/// distinguishes "still synthesising" from "stopped talking to us".
const READ_TIMEOUT: Duration = Duration::from_secs(10);

/// Sentences arrive one at a time about every four seconds, so an idle
/// connection has to survive that gap to be worth pooling at all.
const POOL_IDLE_TIMEOUT: Duration = Duration::from_secs(120);

pub struct MimoBackend {
    client: reqwest::Client,
    api_key: String,
    endpoint: String,
    model: String,
    voice: String,
}

impl MimoBackend {
    pub fn new(api_key: impl Into<String>) -> Result<Self, TtsError> {
        Self::with_client(api_key, default_client()?)
    }

    /// Shares one `reqwest::Client`, and therefore one connection pool, with
    /// whoever else in the process wants one. Keeping the pool is what removes
    /// the connect stage from every sentence after the first.
    pub fn with_client(api_key: impl Into<String>, client: reqwest::Client) -> Result<Self, TtsError> {
        Ok(Self {
            client,
            api_key: api_key.into(),
            endpoint: DEFAULT_ENDPOINT.to_string(),
            model: DEFAULT_MODEL.to_string(),
            voice: DEFAULT_VOICE.to_string(),
        })
    }

    pub fn with_voice(mut self, voice: impl Into<String>) -> Self {
        self.voice = voice.into();
        self
    }

    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = model.into();
        self
    }

    pub fn with_endpoint(mut self, endpoint: impl Into<String>) -> Self {
        self.endpoint = endpoint.into();
        self
    }

    fn body(&self, request: &SpeechRequest) -> serde_json::Value {
        let voice = if request.voice.is_empty() {
            &self.voice
        } else {
            &request.voice
        };
        json!({
            "model": self.model,
            // Assistant, not user. A user message is a style instruction and is
            // not spoken.
            "messages": [{ "role": "assistant", "content": request.text }],
            "audio": { "format": "pcm16", "voice": voice },
            "stream": true,
        })
    }
}

/// The client the plugin builds when nobody hands it one.
pub fn default_client() -> Result<reqwest::Client, TtsError> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(READ_TIMEOUT)
        .pool_idle_timeout(POOL_IDLE_TIMEOUT)
        .build()
        .map_err(|e| TtsError::Transport {
            before_first_byte: true,
            message: e.to_string(),
        })
}

#[async_trait]
impl TtsBackend for MimoBackend {
    fn id(&self) -> &'static str {
        "mimo"
    }

    fn model(&self) -> &str {
        &self.model
    }

    fn format(&self) -> AudioFormat {
        AudioFormat::PCM16_24K_MONO
    }

    fn default_voice(&self) -> &str {
        &self.voice
    }

    async fn synthesize(
        &self,
        request: &SpeechRequest,
        out: mpsc::Sender<Vec<u8>>,
    ) -> Result<(), TtsError> {
        let response = self
            .client
            .post(&self.endpoint)
            .bearer_auth(&self.api_key)
            .json(&self.body(request))
            .send()
            .await
            .map_err(|e| transport(true, &e))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(classify(Some(status.as_u16()), &body));
        }

        let mut response = response;
        let mut parser = SseParser::new();
        let mut sent_any = false;
        let mut finished = false;

        loop {
            let chunk = match response.chunk().await {
                Ok(Some(chunk)) => chunk,
                Ok(None) => break,
                Err(e) => return Err(transport(!sent_any, &e)),
            };
            for event in parser.push(&chunk) {
                match event {
                    SseEvent::Done => {
                        finished = true;
                    }
                    SseEvent::Data(data) => {
                        match audio_from_frame(&data)? {
                            Some(pcm) => {
                                if out.send(pcm).await.is_err() {
                                    return Err(TtsError::Cancelled);
                                }
                                sent_any = true;
                            }
                            // Frames that carry the role, a finish reason or
                            // usage and no audio. Common and not an error.
                            None => {}
                        }
                    }
                }
            }
            if finished {
                break;
            }
        }

        if !sent_any {
            return Err(TtsError::NoAudio);
        }
        Ok(())
    }
}

fn transport(before_first_byte: bool, e: &reqwest::Error) -> TtsError {
    TtsError::Transport {
        before_first_byte,
        message: e.to_string(),
    }
}

/// Pull the PCM out of one SSE frame. `Ok(None)` is a frame with no audio in it.
///
/// The error object is checked before the audio: moderation can land mid-stream
/// with a 200 already on the wire, and it is nested one level down in an
/// OpenAI-shaped `error`.
fn audio_from_frame(data: &str) -> Result<Option<Vec<u8>>, TtsError> {
    let value: serde_json::Value = serde_json::from_str(data)
        .map_err(|e| TtsError::Protocol(format!("frame was not JSON: {e}")))?;

    if value.get("error").is_some_and(|e| !e.is_null()) {
        return Err(classify(None, data));
    }

    let Some(encoded) = value
        .pointer("/choices/0/delta/audio/data")
        .and_then(|v| v.as_str())
    else {
        return Ok(None);
    };
    if encoded.is_empty() {
        return Ok(None);
    }
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map(Some)
        .map_err(|e| TtsError::Protocol(format!("audio was not base64: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_text_to_speak_goes_in_an_assistant_message() {
        let backend = MimoBackend::with_client("k", reqwest::Client::new()).unwrap();
        let body = backend.body(&SpeechRequest {
            text: "早上好".into(),
            voice: String::new(),
        });
        assert_eq!(body["messages"][0]["role"], "assistant");
        assert_eq!(body["messages"][0]["content"], "早上好");
        assert_eq!(body["audio"]["voice"], DEFAULT_VOICE);
        assert_eq!(body["stream"], true);
    }

    #[test]
    fn a_named_voice_wins_over_the_backend_default() {
        let backend = MimoBackend::with_client("k", reqwest::Client::new()).unwrap();
        let body = backend.body(&SpeechRequest {
            text: "x".into(),
            voice: "茉莉".into(),
        });
        assert_eq!(body["audio"]["voice"], "茉莉");
    }

    #[test]
    fn audio_frames_decode_and_other_frames_are_skipped() {
        let pcm = audio_from_frame(
            r#"{"choices":[{"delta":{"audio":{"data":"AAECAw=="}}}]}"#,
        )
        .unwrap();
        assert_eq!(pcm, Some(vec![0, 1, 2, 3]));

        assert_eq!(
            audio_from_frame(r#"{"choices":[{"delta":{"role":"assistant"}}]}"#).unwrap(),
            None
        );
        assert_eq!(
            audio_from_frame(r#"{"choices":[{"finish_reason":"stop","delta":{}}]}"#).unwrap(),
            None
        );
    }

    #[test]
    fn a_moderation_frame_inside_a_200_stream_is_a_refusal() {
        let e = audio_from_frame(
            r#"{"error":{"code":"content_filter","message":"内容审核未通过"}}"#,
        )
        .unwrap_err();
        assert!(matches!(e, TtsError::Moderated { .. }), "{e:?}");
    }

    #[test]
    fn a_frame_that_is_not_json_is_a_protocol_error_not_a_panic() {
        let e = audio_from_frame("not json").unwrap_err();
        assert!(matches!(e, TtsError::Protocol(_)), "{e:?}");
    }
}
