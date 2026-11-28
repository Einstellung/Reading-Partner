// Forward to the native RevenueCat bridge asynchronously while the store sheet
// is open. Fold bridge failures into the same outcome as store failures.

use serde::de::DeserializeOwned;
use tauri::{
    plugin::{mobile::PluginInvokeError, PluginApi, PluginHandle},
    Runtime,
};

use crate::models::{BuyArgs, ConfigureArgs, PurchaseOutcome, RestoreArgs, RestoreOutcome};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_purchases);

pub fn init<R: Runtime, C: DeserializeOwned>(
    api: PluginApi<R, C>,
) -> Result<Purchases<R>, PluginInvokeError> {
    #[cfg(target_os = "android")]
    let handle =
        api.register_android_plugin("com.xinyuan.readingpartner.purchases", "PurchasesPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_purchases)?;

    Ok(Purchases(handle))
}

/// Access to the purchases API.
pub struct Purchases<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Purchases<R> {
    pub async fn configure(&self, api_key: String, app_user_id: String) -> PurchaseOutcome {
        self.0
            .run_mobile_plugin_async(
                "configure",
                ConfigureArgs {
                    api_key,
                    app_user_id,
                },
            )
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
