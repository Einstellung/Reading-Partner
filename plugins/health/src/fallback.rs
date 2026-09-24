// Everywhere that is not iOS: there is no HealthKit, so the answer is null.

use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Health<R>> {
    Ok(Health(app.clone()))
}

/// Access to the Health API.
pub struct Health<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> Health<R> {
    pub async fn read_body(&self) -> crate::Result<Option<serde_json::Value>> {
        Ok(None)
    }
}
