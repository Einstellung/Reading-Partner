package com.xinyuan.readingpartner.purchases

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.revenuecat.purchases.ProductType
import com.revenuecat.purchases.PurchaseParams
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesConfiguration
import com.revenuecat.purchases.PurchasesErrorCode
import com.revenuecat.purchases.PurchasesTransactionException
import com.revenuecat.purchases.awaitGetProducts
import com.revenuecat.purchases.awaitLogIn
import com.revenuecat.purchases.awaitPurchase
import com.revenuecat.purchases.awaitRestore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

@TauriPlugin
class PurchasesPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun configure(invoke: Invoke) = resolve(invoke) {
        // If a switch fails, the SDK may still hold the previous account.
        configuredUserId = null
        val args = invoke.getArgs()
        val apiKey = args.requireString("apiKey").trim()
        val userId = args.requireString("appUserId").trim()
        check(apiKey.isNotEmpty()) { "not configured" }
        check(userId.isNotEmpty()) { "There is no signed-in user to buy for." }

        if (!Purchases.isConfigured) {
            Purchases.configure(
                PurchasesConfiguration.Builder(activity.applicationContext, apiKey)
                    .appUserID(userId)
                    .build()
            )
        } else if (Purchases.sharedInstance.appUserID != userId) {
            Purchases.sharedInstance.awaitLogIn(userId)
        }
        configuredUserId = userId
        JSObject().put("ok", true)
    }

    @Command
    fun buy_lifetime(invoke: Invoke) = resolve(invoke) {
        val productId = invoke.getArgs().requireString("productId")
        val purchases = configuredPurchases()
        val product = purchases.awaitGetProducts(listOf(productId), ProductType.INAPP)
            .firstOrNull { it.id == productId }
            ?: error("Google Play did not offer ${productId}.")

        check(!activity.isFinishing && !activity.isDestroyed) {
            "The purchase screen is unavailable."
        }
        val params = PurchaseParams.Builder(activity, product).build()
        try {
            purchases.awaitPurchase(params)
            JSObject().put("ok", true)
        } catch (e: PurchasesTransactionException) {
            if (!e.userCancelled && e.code != PurchasesErrorCode.PurchaseCancelledError) throw e
            JSObject().put("ok", false).put("cancelled", true)
        }
    }

    @Command
    fun restore(invoke: Invoke) = resolve(invoke, restore = true) {
        val entitlementId = invoke.getArgs().requireString("entitlementId")
        val info = configuredPurchases().awaitRestore()
        JSObject().put("ok", true).put("active", info.entitlements.active.containsKey(entitlementId))
    }

    private fun resolve(invoke: Invoke, restore: Boolean = false, command: suspend () -> JSObject) {
        storeScope.launch {
            storeMutex.withLock {
                val outcome = try {
                    command()
                } catch (e: Exception) {
                    JSObject().put("ok", false)
                        .put("error", e.message ?: "Google Play purchase request failed.")
                        .apply { if (restore) put("active", false) }
                }
                invoke.resolve(outcome)
            }
        }
    }

    private fun configuredPurchases(): Purchases {
        check(Purchases.isConfigured) { "not configured" }
        val purchases = Purchases.sharedInstance
        check(purchases.appUserID == configuredUserId) { "not configured" }
        return purchases
    }

    private fun JSObject.requireString(key: String): String =
        opt(key) as? String ?: error("The arguments did not parse: ${key} must be a string.")

    private companion object {
        // RevenueCat is a process-wide singleton. Keep the selected user fixed
        // for the duration of each purchase or restore, even across suspension.
        val storeScope = CoroutineScope(Dispatchers.Main)
        val storeMutex = Mutex()
        var configuredUserId: String? = null
    }
}
