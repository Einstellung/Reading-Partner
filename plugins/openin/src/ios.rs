// iOS: hand the path to the Swift plugin, which presents the share sheet.
//
// The async variant of run_mobile_plugin is deliberate, same as in
// plugins/voice: the blocking one parks the calling thread on a channel recv
// until Swift resolves, and Swift resolves `open_in` only once the sheet has
// finished animating in.

use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::OpenInArgs;

tauri::ios_plugin_binding!(init_plugin_openin);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<OpenIn<R>> {
    let handle = api.register_ios_plugin(init_plugin_openin)?;
    Ok(OpenIn(handle))
}

/// Access to the Open in… API.
pub struct OpenIn<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> OpenIn<R> {
    /// True without asking Swift. Every iPhone and iPad has a share sheet; the
    /// question this command exists for is which host is running, not whether
    /// a particular device can do it, and a round trip would only add a way for
    /// the probe to fail.
    pub async fn is_available(&self) -> crate::Result<bool> {
        Ok(true)
    }

    pub async fn open(&self, path: String) -> crate::Result<()> {
        self.0
            .run_mobile_plugin_async("open_in", OpenInArgs { path })
            .await
            .map_err(Into::into)
    }
}
