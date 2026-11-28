// The frontend-facing commands forward to the platform's store.

use tauri::{command, AppHandle, Runtime};

use crate::models::{PurchaseOutcome, RestoreOutcome};
use crate::PurchasesExt;

/// Start RevenueCat for this signed-in user. `app_user_id` is the Supabase
/// user id. Calling it again with another id switches the user.
#[command]
pub(crate) async fn configure<R: Runtime>(
    app: AppHandle<R>,
    api_key: String,
    app_user_id: String,
) -> PurchaseOutcome {
    app.purchases().configure(api_key, app_user_id).await
}

/// Buy the non-consumable lifetime unlock. Resolves when the store sheet
/// is done with; a buyer who closed it is `cancelled: true`, not an error.
#[command]
pub(crate) async fn buy_lifetime<R: Runtime>(
    app: AppHandle<R>,
    product_id: String,
) -> PurchaseOutcome {
    app.purchases().buy_lifetime(product_id).await
}

/// Restore earlier purchases and say whether `entitlement_id` is active.
#[command]
pub(crate) async fn restore<R: Runtime>(
    app: AppHandle<R>,
    entitlement_id: String,
) -> RestoreOutcome {
    app.purchases().restore(entitlement_id).await
}
