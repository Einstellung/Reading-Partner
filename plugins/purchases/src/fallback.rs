// Everywhere that is not iOS: Android has no Google Play Billing yet and the
// desktop has no store at all. The plugin still registers, so the commands
// answer "unavailable" instead of failing the invoke with "command not found".

use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::{PurchaseOutcome, RestoreOutcome};

const UNAVAILABLE: &str = "unavailable";

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> Purchases<R> {
    Purchases(app.clone())
}

/// Access to the purchases API.
pub struct Purchases<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> Purchases<R> {
    pub async fn configure(&self, _api_key: String, _app_user_id: String) -> PurchaseOutcome {
        PurchaseOutcome::failed(UNAVAILABLE)
    }

    pub async fn buy_lifetime(&self, _product_id: String) -> PurchaseOutcome {
        PurchaseOutcome::failed(UNAVAILABLE)
    }

    pub async fn restore(&self, _entitlement_id: String) -> RestoreOutcome {
        RestoreOutcome::failed(UNAVAILABLE)
    }
}
