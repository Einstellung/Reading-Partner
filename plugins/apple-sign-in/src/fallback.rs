// Everywhere that is not iOS. The plugin still registers, so the availability
// probe and a stray sign-in answer "unavailable" instead of failing the invoke
// with "command not found".

use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::SignInResult;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<AppleSignIn<R>> {
    Ok(AppleSignIn(app.clone()))
}

/// Access to the Sign in with Apple API.
pub struct AppleSignIn<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> AppleSignIn<R> {
    pub async fn is_available(&self) -> crate::Result<bool> {
        Ok(false)
    }

    pub async fn sign_in(&self, _nonce: String) -> crate::Result<SignInResult> {
        Ok(SignInResult {
            ok: false,
            error: Some("unavailable".to_string()),
            ..Default::default()
        })
    }
}
