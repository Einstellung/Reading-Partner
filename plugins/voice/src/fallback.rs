// Everywhere that is not iOS. SpeechAnalyzer is an iOS 26 framework, so there
// is nothing to implement here — but the plugin still registers, so a desktop
// build resolves `voice:default` and answers every invoke instead of failing
// with "command not found". The webview never gets this far anyway:
// hasOnDeviceDictation() is false off iOS and the composer keeps the keyboard.

use serde::de::DeserializeOwned;
use tauri::{ipc::Channel, plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;
use crate::Error;

// Shown to the user verbatim if it ever surfaces, so it is a sentence.
const UNSUPPORTED: &str = "On-device dictation only runs on iOS 26 and later.";

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Voice<R>> {
    Ok(Voice(app.clone()))
}

/// Access to the voice APIs.
pub struct Voice<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> Voice<R> {
    /// Rejecting rather than resolving: a start that answers "fine" and then
    /// never emits leaves the hold stuck listening to a microphone nobody
    /// opened.
    pub async fn start_dictation(
        &self,
        _locale: Option<String>,
        _contextual_strings: Option<Vec<String>>,
    ) -> crate::Result<()> {
        Err(Error::Unsupported(UNSUPPORTED.to_string()))
    }

    /// Nothing to let go of, and saying so would be noise: the composer calls
    /// this whenever voice mode ends, on every host that reaches the code.
    pub async fn release_microphone(&self) -> crate::Result<()> {
        Ok(())
    }

    /// Rejecting, like the start above: the bench shows whatever comes back as
    /// the state the probe reached, and an answer saying "off" would read as a
    /// stage that had been entered and left rather than as a host with no
    /// microphone stack to park.
    pub async fn set_indicator_probe(&self, _stage: String) -> crate::Result<IndicatorProbe> {
        Err(Error::Unsupported(UNSUPPORTED.to_string()))
    }

    /// Silence, not a rejection: an empty transcript is the same answer a hold
    /// that recorded nothing gives, and the webview owns the sentence for it.
    pub async fn stop_dictation(&self) -> crate::Result<StopDictation> {
        Ok(StopDictation {
            transcript: String::new(),
        })
    }

    pub async fn cancel_dictation(&self) -> crate::Result<()> {
        Ok(())
    }

    // Accepting a listener that will never fire beats rejecting it: the client
    // subscribes before it asks whether anything is available.
    pub async fn register_listener(&self, _event: String, _handler: Channel) -> crate::Result<()> {
        Ok(())
    }

    pub async fn remove_listener(&self, _event: String, _channel_id: u32) -> crate::Result<()> {
        Ok(())
    }
}

impl<R: Runtime> Voice<R> {
    /// Rejecting: a synthesiser told "queued" by a host with no player would
    /// keep synthesising a turn nobody can hear.
    pub async fn enqueue_speech(
        &self,
        _utterance: u64,
        _index: u32,
        _chars: u32,
        _last: bool,
        _sample_rate: u32,
        _trim: bool,
        _pcm: Vec<u8>,
    ) -> crate::Result<SpeechEnqueued> {
        Err(Error::Unsupported(UNSUPPORTED.to_string()))
    }

    /// Silence, like `release_microphone`: stopping a voice that never started
    /// is what a teardown asks for, and it has nowhere to show a rejection.
    pub async fn stop_speaking(&self, _reason: String) -> crate::Result<SpeechPosition> {
        Ok(SpeechPosition {
            speaking: false,
            utterance: 0,
            index: -1,
            char_offset: 0,
            played_ms: 0.0,
        })
    }

    pub async fn speech_probe(&self, _args: serde_json::Value) -> crate::Result<SpeechReport> {
        Err(Error::Unsupported(UNSUPPORTED.to_string()))
    }

    pub async fn speech_report(&self) -> crate::Result<SpeechReport> {
        Err(Error::Unsupported(UNSUPPORTED.to_string()))
    }
}
