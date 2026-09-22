// The frontend-facing commands. Both are thin forwarders; the sheet itself is
// in Swift, under ios/.

use tauri::{command, AppHandle, Runtime};

use crate::OpenInExt;
use crate::Result;

/// Whether this host can hand a file to another app at all. The frontend draws
/// the Open in… control only when this is true.
#[command]
pub(crate) async fn is_available<R: Runtime>(app: AppHandle<R>) -> Result<bool> {
    app.open_in().is_available().await
}

/// Show the share sheet for one file. Resolves once the sheet is up, not once
/// the reader has chosen something: what they pick, or that they dismissed it,
/// is never reported back.
///
/// `name` is the display file name the reader should see instead of the one on
/// disk; see [`crate::OpenInArgs`].
#[command]
pub(crate) async fn open_in<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    name: Option<String>,
) -> Result<()> {
    app.open_in().open(path, name).await
}
