use tauri::{command, AppHandle, Runtime};

use crate::HealthExt;
use crate::Result;

/// The raw body payload from HealthKit, or null where there is no HealthKit.
/// Asks for read authorization first; the system shows its sheet only the
/// first time.
#[command]
pub(crate) async fn read_body<R: Runtime>(app: AppHandle<R>) -> Result<Option<serde_json::Value>> {
    app.health().read_body().await
}
