// iOS: hand the hashed nonce to the Swift plugin, which runs the
// ASAuthorizationController request and resolves once the user is done with the
// sheet. The async variant of run_mobile_plugin, as in plugins/openin: the
// blocking one parks the calling thread for as long as the sheet is up.

use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::{SignInArgs, SignInResult};

tauri::ios_plugin_binding!(init_plugin_apple_sign_in);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<AppleSignIn<R>> {
    let handle = api.register_ios_plugin(init_plugin_apple_sign_in)?;
    Ok(AppleSignIn(handle))
}

/// Access to the Sign in with Apple API.
pub struct AppleSignIn<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> AppleSignIn<R> {
    /// True without asking Swift: AuthenticationServices is on every iOS device
    /// the app supports.
    pub async fn is_available(&self) -> crate::Result<bool> {
        Ok(true)
    }

    pub async fn sign_in(&self, nonce: String) -> crate::Result<SignInResult> {
        self.0
            .run_mobile_plugin_async("sign_in", SignInArgs { nonce })
            .await
            .map_err(Into::into)
    }
}
