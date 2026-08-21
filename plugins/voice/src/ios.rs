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
    audio_profile: Option<String>,
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
        audio_profile: Option<String>,
    ) -> crate::Result<()> {
        self.0
            .run_mobile_plugin_async(
                "start_dictation",
                StartDictationArgs {
                    locale,
                    contextual_strings,
                    audio_profile,
                },
            )
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
