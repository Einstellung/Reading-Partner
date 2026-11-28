// iOS: hand each command to the Swift plugin, which talks to RevenueCat.
//
// The async variant of run_mobile_plugin, as in plugins/openin: the blocking
// one parks the calling thread until Swift resolves, and Swift resolves
// `buy_lifetime` only once the buyer has finished with the App Store sheet.
//
// Swift resolves every command with an outcome and never rejects; a rejection
// that still arrives (the payload did not decode, the plugin is missing) is
// folded into the same `ok: false` shape so the frontend has one thing to read.

use serde::de::DeserializeOwned;
use tauri::{
    plugin::{mobile::PluginInvokeError, PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::{BuyArgs, ConfigureArgs, PurchaseOutcome, RestoreArgs, RestoreOutcome};

tauri::ios_plugin_binding!(init_plugin_purchases);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<Purchases<R>, PluginInvokeError> {
    let handle = api.register_ios_plugin(init_plugin_purchases)?;
    Ok(Purchases(handle))
}

/// Access to the purchases API.
pub struct Purchases<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Purchases<R> {
    pub async fn configure(&self, api_key: String, app_user_id: String) -> PurchaseOutcome {
        self.0
            .run_mobile_plugin_async("configure", ConfigureArgs { api_key, app_user_id })
            .await
            .unwrap_or_else(|e| PurchaseOutcome::failed(e.to_string()))
    }

    pub async fn buy_lifetime(&self, product_id: String) -> PurchaseOutcome {
        self.0
            .run_mobile_plugin_async("buy_lifetime", BuyArgs { product_id })
            .await
            .unwrap_or_else(|e| PurchaseOutcome::failed(e.to_string()))
    }

    pub async fn restore(&self, entitlement_id: String) -> RestoreOutcome {
        self.0
            .run_mobile_plugin_async("restore", RestoreArgs { entitlement_id })
            .await
            .unwrap_or_else(|e| RestoreOutcome::failed(e.to_string()))
    }
}
