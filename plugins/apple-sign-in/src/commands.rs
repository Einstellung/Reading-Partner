// The frontend-facing commands, thin forwarders to the platform half.

use tauri::{command, AppHandle, Runtime};

use crate::models::SignInResult;
use crate::AppleSignInExt;
use crate::Result;

/// Whether this host has native Sign in with Apple. True on iOS only.
#[command]
pub(crate) async fn is_available<R: Runtime>(app: AppHandle<R>) -> Result<bool> {
    app.apple_sign_in().is_available().await
}

/// Run the Apple sign-in sheet. `nonce` is the SHA-256 (hex) of the raw nonce
/// the caller keeps for the Supabase exchange.
#[command]
pub(crate) async fn sign_in<R: Runtime>(app: AppHandle<R>, nonce: String) -> Result<SignInResult> {
    app.apple_sign_in().sign_in(nonce).await
}
