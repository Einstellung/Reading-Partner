// Everywhere that is not iOS. UIActivityViewController is UIKit, so there is
// nothing to implement here — but the plugin still registers, so a desktop or
// Android build resolves `openin:default` and answers `is_available` with false
// instead of failing the invoke with "command not found". That false is what
// hides the Open in… control (定案: no native capability, no icon), so the
// probe has to succeed everywhere for the degradation to be the quiet one.

use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::Error;

// Shown to the user verbatim if it ever surfaces, so it is a sentence. It only
// can surface if something called `open_in` without asking `is_available`
// first.
const UNSUPPORTED: &str = "Opening a file in another app only works on iOS.";

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<OpenIn<R>> {
    Ok(OpenIn(app.clone()))
}

/// Access to the Open in… API.
pub struct OpenIn<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> OpenIn<R> {
    /// Resolving with false rather than rejecting: the caller's question is
    /// whether to draw a button, and a rejection would make "no" the same
    /// answer as "the probe broke".
    pub async fn is_available(&self) -> crate::Result<bool> {
        Ok(false)
    }

    /// Rejecting: a hand-over that answers "fine" and then shows nothing is a
    /// reader waiting for a sheet that will never come.
    pub async fn open(&self, _path: String) -> crate::Result<()> {
        Err(Error::Unsupported(UNSUPPORTED.to_string()))
    }
}
