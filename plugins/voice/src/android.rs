// Android (docs/companion/89): the call and the voice run in the `:voice`
// process, over the socket engine_link.rs speaks. Kotlin's VoicePlugin opens
// that socket and answers what only the device knows; everything else here is
// a forwarder to the link. Hold-to-talk dictation is refused as on the
// desktop (fallback.rs): `hasOnDeviceDictation()` is false on Android.
//
// The three Kotlin methods, each answering an object:
//
//   capability  -> { call: bool }    the memory gate (docs/companion/89, 内存门槛)
//   noBackupDir -> { path: string }  Context.getNoBackupFilesDir()
//   openEngine  -> { fd: int }       RECORD_AUDIO granted, `:voice` up, and the
//                                    detached fd of this process's end of a
//                                    socket pair

use std::os::fd::FromRawFd;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::Arc;

use serde::de::DeserializeOwned;
use serde::Deserialize;
use tauri::{
    ipc::Channel,
    plugin::{PluginApi, PluginHandle},
    AppHandle, Manager, Runtime,
};
use voice_wire::Threads;

use crate::engine_link::{EngineLink, Pipe};
use crate::fallback;
use crate::kokoro::download::Downloader;
use crate::models::*;
use crate::speaker::SpeechOut;
use crate::Error;

const PLUGIN_ID: &str = "com.xinyuan.readingpartner.voice";

/// Off until slice 6 adds the Kotlin module and build.rs's
/// `.android_path("android")` with it: registering a class the APK does not
/// have leaves a ClassNotFoundException pending on the UI thread. While it is
/// off the capability is false, so the webview offers no call and no voice.
const KOTLIN_PLUGIN: bool = false;

/// What a call is refused with when there is no voice process to open.
const NO_ENGINE: &str = "The voice call is not available on this device.";

#[derive(Deserialize)]
struct Dir {
    path: String,
}

#[derive(Deserialize)]
struct Fd {
    fd: i32,
}

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> std::result::Result<Voice<R>, Box<dyn std::error::Error>> {
    let kotlin = if KOTLIN_PLUGIN {
        Some(api.register_android_plugin(PLUGIN_ID, "VoicePlugin")?)
    } else {
        None
    };
    // The models stay out of Auto Backup by living under no_backup.
    let base = match &kotlin {
        Some(kotlin) => PathBuf::from(kotlin.run_mobile_plugin::<Dir>("noBackupDir", ())?.path),
        None => app.path().app_local_data_dir()?,
    };
    let opener = kotlin.clone();
    Ok(Voice {
        link: EngineLink::new(Box::new(move || open_engine(opener.as_ref()))),
        models: Arc::new(Downloader::for_host(&base)),
        kotlin,
        desktop: fallback::Voice::new(app),
    })
}

/// The link's `Connect`. Blocking: Kotlin may be showing the microphone
/// permission dialog.
fn open_engine<R: Runtime>(kotlin: Option<&PluginHandle<R>>) -> std::result::Result<Pipe, String> {
    let kotlin = kotlin.ok_or_else(|| NO_ENGINE.to_string())?;
    let Fd { fd } = kotlin.run_mobile_plugin("openEngine", ()).map_err(|e| e.to_string())?;
    // Kotlin detached the descriptor: this process owns it from here.
    let stream = unsafe { UnixStream::from_raw_fd(fd) };
    Pipe::unix(stream).map_err(|e| e.to_string())
}

/// Access to the voice APIs.
pub struct Voice<R: Runtime> {
    kotlin: Option<PluginHandle<R>>,
    link: Arc<EngineLink>,
    models: Arc<Downloader>,
    /// The answers for what Android does not do: dictation and the bench.
    desktop: fallback::Voice<R>,
}

impl<R: Runtime> Voice<R> {
    pub fn link(&self) -> Arc<EngineLink> {
        self.link.clone()
    }

    /// Both packs, under `noBackupDir`.
    pub fn models(&self) -> Arc<Downloader> {
        self.models.clone()
    }

    /// Kotlin's answer; anything short of one is no.
    pub async fn voice_capability(&self) -> VoiceCapability {
        let call = match &self.kotlin {
            Some(kotlin) => kotlin
                .run_mobile_plugin_async::<VoiceCapability>("capability", ())
                .await
                .is_ok_and(|c| c.call),
            None => false,
        };
        VoiceCapability { call }
    }

    /// `Open` on the engine; its refusal (the download sentence among them)
    /// is this command's. The call's events wait until the answer has gone
    /// out, as ConversationRun's `beginEmitting` does.
    pub async fn start_conversation(
        &self,
        _locale: Option<String>,
        _contextual_strings: Option<Vec<String>>,
    ) -> crate::Result<()> {
        self.link
            .open(self.models.engine_files(), Threads::default())
            .await
            .map_err(Error::Speech)?;
        let link = self.link.clone();
        tauri::async_runtime::spawn(async move { link.begin_emitting() });
        Ok(())
    }

    pub async fn stop_conversation(&self) -> crate::Result<()> {
        self.link.close().await.map_err(Error::Speech)
    }

    pub async fn set_speech_volume(&self, value: f64) -> crate::Result<()> {
        self.link.set_volume(value).await.map_err(Error::Speech)
    }

    /// Nothing to do: the models are under `noBackupDir` already.
    pub async fn exclude_from_backup(&self, _path: String) -> crate::Result<()> {
        Ok(())
    }

    pub async fn register_listener(&self, event: String, handler: Channel) -> crate::Result<()> {
        self.link.listeners().register(event, handler);
        Ok(())
    }

    pub async fn remove_listener(&self, event: String, channel_id: u32) -> crate::Result<()> {
        self.link.listeners().remove(&event, channel_id);
        Ok(())
    }

    pub async fn start_dictation(
        &self,
        locale: Option<String>,
        contextual_strings: Option<Vec<String>>,
    ) -> crate::Result<()> {
        self.desktop.start_dictation(locale, contextual_strings).await
    }

    pub async fn stop_dictation(&self) -> crate::Result<StopDictation> {
        self.desktop.stop_dictation().await
    }

    pub async fn cancel_dictation(&self) -> crate::Result<()> {
        self.desktop.cancel_dictation().await
    }

    pub async fn release_microphone(&self) -> crate::Result<()> {
        self.desktop.release_microphone().await
    }

    pub async fn set_indicator_probe(&self, stage: String) -> crate::Result<IndicatorProbe> {
        self.desktop.set_indicator_probe(stage).await
    }
}

// The playback half: the engine's player, over the link.
impl<R: Runtime> Voice<R> {
    #[allow(clippy::too_many_arguments)]
    pub async fn enqueue_speech(
        &self,
        utterance: u64,
        index: u32,
        chars: u32,
        last: bool,
        part: u32,
        complete: bool,
        marks: crate::tts::SentenceMarks,
        sample_rate: u32,
        pcm: Vec<u8>,
    ) -> crate::Result<SpeechEnqueued> {
        SpeechOut::enqueue_speech(&self.link, utterance, index, chars, last, part, complete, marks, sample_rate, pcm)
            .await
    }

    pub async fn finish_speech(&self, utterance: u64) -> crate::Result<()> {
        SpeechOut::finish_speech(&self.link, utterance).await
    }

    pub async fn stop_speaking(&self, reason: String) -> crate::Result<SpeechPosition> {
        SpeechOut::stop_speaking(&self.link, reason).await
    }

    pub async fn speech_probe(&self, args: serde_json::Value) -> crate::Result<SpeechReport> {
        self.desktop.speech_probe(args).await
    }

    pub async fn speech_report(&self) -> crate::Result<SpeechReport> {
        self.desktop.speech_report().await
    }

    pub async fn harness(&self, args: serde_json::Value) -> crate::Result<serde_json::Value> {
        self.desktop.harness(args).await
    }
}
