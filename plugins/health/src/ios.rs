// iOS: forward to the Swift plugin. The async variant of run_mobile_plugin, as
// in plugins/voice and plugins/openin: Swift resolves only after the
// authorization sheet has been answered, and the blocking variant would park
// the calling thread on a channel for that long.

use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

tauri::ios_plugin_binding!(init_plugin_health);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<Health<R>> {
    let handle = api.register_ios_plugin(init_plugin_health)?;
    Ok(Health(handle))
}

/// Access to the Health API.
pub struct Health<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Health<R> {
    pub async fn read_body(&self) -> crate::Result<Option<serde_json::Value>> {
        self.0
            .run_mobile_plugin_async::<Option<serde_json::Value>>("read_body", ())
            .await
            .map_err(Into::into)
    }
}
