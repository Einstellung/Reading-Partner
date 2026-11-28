// The shapes that cross to Swift and back. Swift decodes and encodes them with
// a plain JSONDecoder/JSONEncoder and no key strategy, so the property names
// have to be exactly what serde writes.

use serde::{Deserialize, Serialize};

/// Arguments of `configure`. `app_user_id` is the Supabase user id, so a
/// purchase made on one device unlocks every device signed in to that account.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureArgs {
    pub api_key: String,
    pub app_user_id: String,
}

/// Arguments of `buy_lifetime`: the App Store product id of the unlock.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuyArgs {
    pub product_id: String,
}

/// Arguments of `restore`: the RevenueCat entitlement the unlock grants.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreArgs {
    pub entitlement_id: String,
}

/// The answer of `configure` and `buy_lifetime`. Every command resolves with
/// one of these and never rejects: a failure is `ok: false` with a sentence in
/// `error`, and a buyer who closed the sheet is `cancelled: true`.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseOutcome {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancelled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl PurchaseOutcome {
    pub fn failed(error: impl Into<String>) -> Self {
        Self {
            ok: false,
            cancelled: None,
            error: Some(error.into()),
        }
    }
}

/// The answer of `restore`. `active` is whether the lifetime entitlement is
/// active after the restore.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOutcome {
    pub ok: bool,
    #[serde(default)]
    pub active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl RestoreOutcome {
    pub fn failed(error: impl Into<String>) -> Self {
        Self {
            ok: false,
            active: false,
            error: Some(error.into()),
        }
    }
}
