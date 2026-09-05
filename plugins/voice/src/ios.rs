// iOS: hand every command to the Swift plugin and hand its answer back.
//
// The async variant of run_mobile_plugin is deliberate. The blocking one parks
// the calling thread on a channel recv until Swift resolves, and Swift resolves
// `start_dictation` only after the model download finishes, which is minutes on
// a device that has never run the transcriber.

use serde::de::DeserializeOwned;
use tauri::{
    ipc::Channel,
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

tauri::ios_plugin_binding!(init_plugin_voice);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<Voice<R>> {
    let handle = api.register_ios_plugin(init_plugin_voice)?;
    Ok(Voice(handle))
}

/// Access to the voice APIs.
pub struct Voice<R: Runtime>(PluginHandle<R>);

// Swift decodes these with a plain JSONDecoder and no key strategy, so the
// property names have to be exactly what serde writes: camelCase.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StartDictationArgs {
    locale: Option<String>,
    contextual_strings: Option<Vec<String>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SetSpeechVolumeArgs {
    value: f64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct IndicatorProbeArgs {
    stage: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RegisterListenerArgs {
    event: String,
    // Serializes as the `__CHANNEL__:<id>` string the Swift side's Channel
    // decoder expects.
    handler: Channel,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoveListenerArgs {
    event: String,
    channel_id: u32,
}

impl<R: Runtime> Voice<R> {
    pub async fn start_dictation(
        &self,
        locale: Option<String>,
        contextual_strings: Option<Vec<String>>,
    ) -> crate::Result<()> {
        self.0
            .run_mobile_plugin_async(
                "start_dictation",
                StartDictationArgs {
                    locale,
                    contextual_strings,
                },
            )
            .await
            .map_err(Into::into)
    }

    /// The call takes the same two arguments as a hold, so it borrows the
    /// hold's struct: Swift decodes both with `StartDictationArgs`.
    pub async fn start_conversation(
        &self,
        locale: Option<String>,
        contextual_strings: Option<Vec<String>>,
    ) -> crate::Result<()> {
        self.0
            .run_mobile_plugin_async(
                "start_conversation",
                StartDictationArgs {
                    locale,
                    contextual_strings,
                },
            )
            .await
            .map_err(Into::into)
    }

    pub async fn stop_conversation(&self) -> crate::Result<()> {
        self.0
            .run_mobile_plugin_async("stop_conversation", ())
            .await
            .map_err(Into::into)
    }

    pub async fn set_speech_volume(&self, value: f64) -> crate::Result<()> {
        self.0
            .run_mobile_plugin_async("set_speech_volume", SetSpeechVolumeArgs { value })
            .await
            .map_err(Into::into)
    }

    pub async fn release_microphone(&self) -> crate::Result<()> {
        self.0
            .run_mobile_plugin_async("release_microphone", ())
            .await
            .map_err(Into::into)
    }

    pub async fn set_indicator_probe(&self, stage: String) -> crate::Result<IndicatorProbe> {
        self.0
            .run_mobile_plugin_async("set_indicator_probe", IndicatorProbeArgs { stage })
            .await
            .map_err(Into::into)
    }

    pub async fn stop_dictation(&self) -> crate::Result<StopDictation> {
        self.0
            .run_mobile_plugin_async("stop_dictation", ())
            .await
            .map_err(Into::into)
    }

    pub async fn cancel_dictation(&self) -> crate::Result<()> {
        self.0
            .run_mobile_plugin_async("cancel_dictation", ())
            .await
            .map_err(Into::into)
    }

    // The Swift names are camelCase here because these two are Tauri's own
    // methods on the Plugin base class, not ours.
    pub async fn register_listener(&self, event: String, handler: Channel) -> crate::Result<()> {
        self.0
            .run_mobile_plugin_async("registerListener", RegisterListenerArgs { event, handler })
            .await
            .map_err(Into::into)
    }

    pub async fn remove_listener(&self, event: String, channel_id: u32) -> crate::Result<()> {
        self.0
            .run_mobile_plugin_async("removeListener", RemoveListenerArgs { event, channel_id })
            .await
            .map_err(Into::into)
    }
}

// The playback half (docs/33, M-voice-2). Swift decodes these with a plain
// JSONDecoder, so the property names are camelCase here too.
//
// `enqueue_speech` is not a `#[tauri::command]` and never becomes one: the
// synthesiser lives in Rust, so the audio would otherwise cross the bridge into
// the webview and back out again for nothing. The three below it are commands
// because the webview is what interrupts a turn and what drives the bench.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EnqueueSpeechArgs {
    utterance: u64,
    index: u32,
    /// How many characters this sentence is. Swift interpolates a character
    /// offset inside it and never sees the text.
    chars: u32,
    last: bool,
    sample_rate: u32,
    /// Little-endian 16-bit mono, already trimmed (src/tts/trim.rs) and already
    /// carrying the pause that follows the sentence. serde writes a `Vec<u8>`
    /// as a JSON array of numbers, so this is base64'd by hand into the string
    /// Swift's `Data` decoder reads.
    pcm: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FinishSpeechArgs {
    /// The turn that is over. Carried so that a call made about a turn the
    /// player has already left cannot end the one that replaced it.
    utterance: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StopSpeakingArgs {
    reason: String,
}

impl<R: Runtime> Voice<R> {
    /// One sentence onto the back of the playback queue. Called by the TTS
    /// client as each sentence finishes streaming, in order.
    pub async fn enqueue_speech(
        &self,
        utterance: u64,
        index: u32,
        chars: u32,
        last: bool,
        sample_rate: u32,
        pcm: Vec<u8>,
    ) -> crate::Result<SpeechEnqueued> {
        use base64::Engine as _;
        self.0
            .run_mobile_plugin_async(
                "enqueue_speech",
                EnqueueSpeechArgs {
                    utterance,
                    index,
                    chars,
                    last,
                    sample_rate,
                    pcm: base64::engine::general_purpose::STANDARD.encode(pcm),
                },
            )
            .await
            .map_err(Into::into)
    }

    /// This turn has no more sentences. Queues nothing and stops nothing: it
    /// is `last` for a turn whose final sentence never came back, so that a
    /// turn that ended is not heard as a turn that starved.
    pub async fn finish_speech(&self, utterance: u64) -> crate::Result<()> {
        self.0
            .run_mobile_plugin_async("finish_speech", FinishSpeechArgs { utterance })
            .await
            .map_err(Into::into)
    }

    pub async fn stop_speaking(&self, reason: String) -> crate::Result<SpeechPosition> {
        self.0
            .run_mobile_plugin_async("stop_speaking", StopSpeakingArgs { reason })
            .await
            .map_err(Into::into)
    }

    pub async fn speech_probe(&self, args: serde_json::Value) -> crate::Result<SpeechReport> {
        self.0
            .run_mobile_plugin_async("speech_probe", args)
            .await
            .map_err(Into::into)
    }

    pub async fn speech_report(&self) -> crate::Result<SpeechReport> {
        self.0
            .run_mobile_plugin_async("speech_report", ())
            .await
            .map_err(Into::into)
    }
}
