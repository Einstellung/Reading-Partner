// The lifetime unlock through RevenueCat (docs/platform/713): configure, buy
// and restore.
//
// Tauri dispatches a command by building the selector `<command>:` from the
// name Rust passed to run_mobile_plugin, so each entry point carries an
// explicit Objective-C selector matching the snake_case command name.
//
// Every command resolves with an outcome and none rejects: a failure is
// `ok: false` with a sentence, so the frontend reads one shape. Nothing here
// touches `Purchases.shared` before `Purchases.isConfigured` says it exists,
// because `shared` traps when it does not.

import Foundation
import RevenueCat
import Tauri

struct ConfigureArgs: Decodable {
    let apiKey: String
    let appUserId: String
}

struct BuyArgs: Decodable {
    let productId: String
}

struct RestoreArgs: Decodable {
    let entitlementId: String
}

/// What `configure` and `buy_lifetime` resolve with. A buyer who closed the
/// App Store sheet is `cancelled: true` and no error.
struct PurchaseOutcome: Encodable {
    let ok: Bool
    var cancelled: Bool? = nil
    var error: String? = nil
}

/// What `restore` resolves with. `active` is whether the lifetime entitlement
/// is active once the restore is done.
struct RestoreOutcome: Encodable {
    let ok: Bool
    let active: Bool
    var error: String? = nil
}

private let notConfigured = "not configured"

class PurchasesPlugin: Tauri.Plugin {
    @objc(configure:)
    public func configure(_ invoke: Tauri.Invoke) {
        let args: ConfigureArgs
        do {
            args = try invoke.parseArgs(ConfigureArgs.self)
        } catch {
            invoke.resolve(PurchaseOutcome(ok: false, error: "The arguments did not parse: \(error)"))
            return
        }
        let apiKey = args.apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let userId = args.appUserId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !apiKey.isEmpty else {
            invoke.resolve(PurchaseOutcome(ok: false, error: notConfigured))
            return
        }
        // An empty id makes RevenueCat invent an anonymous user, and a purchase
        // made under it belongs to no account.
        guard !userId.isEmpty else {
            invoke.resolve(PurchaseOutcome(ok: false, error: "There is no signed-in user to buy for."))
            return
        }

        Task { @MainActor in
            if Purchases.isConfigured {
                // Configured once per process; another account signing in is a
                // switch of user, not a second configure.
                if Purchases.shared.appUserID != userId {
                    do {
                        _ = try await Purchases.shared.logIn(userId)
                    } catch {
                        invoke.resolve(PurchaseOutcome(ok: false, error: error.localizedDescription))
                        return
                    }
                }
                invoke.resolve(PurchaseOutcome(ok: true))
                return
            }
            Purchases.configure(withAPIKey: apiKey, appUserID: userId)
            invoke.resolve(PurchaseOutcome(ok: true))
        }
    }

    @objc(buy_lifetime:)
    public func buyLifetime(_ invoke: Tauri.Invoke) {
        let args: BuyArgs
        do {
            args = try invoke.parseArgs(BuyArgs.self)
        } catch {
            invoke.resolve(PurchaseOutcome(ok: false, error: "The arguments did not parse: \(error)"))
            return
        }
        guard Purchases.isConfigured else {
            invoke.resolve(PurchaseOutcome(ok: false, error: notConfigured))
            return
        }

        Task { @MainActor in
            let products = await Purchases.shared.products([args.productId])
            guard let product = products.first(where: { $0.productIdentifier == args.productId }) else {
                invoke.resolve(PurchaseOutcome(
                    ok: false, error: "The App Store did not offer \(args.productId)."))
                return
            }
            do {
                let result = try await Purchases.shared.purchase(product: product)
                if result.userCancelled {
                    invoke.resolve(PurchaseOutcome(ok: false, cancelled: true))
                } else {
                    invoke.resolve(PurchaseOutcome(ok: true))
                }
            } catch {
                // The async API throws on a cancel rather than returning
                // userCancelled, so the cancel is recognised here too.
                if PurchasesPlugin.isCancellation(error) {
                    invoke.resolve(PurchaseOutcome(ok: false, cancelled: true))
                } else {
                    invoke.resolve(PurchaseOutcome(ok: false, error: error.localizedDescription))
                }
            }
        }
    }

    @objc(restore:)
    public func restore(_ invoke: Tauri.Invoke) {
        let args: RestoreArgs
        do {
            args = try invoke.parseArgs(RestoreArgs.self)
        } catch {
            invoke.resolve(RestoreOutcome(
                ok: false, active: false, error: "The arguments did not parse: \(error)"))
            return
        }
        guard Purchases.isConfigured else {
            invoke.resolve(RestoreOutcome(ok: false, active: false, error: notConfigured))
            return
        }

        Task { @MainActor in
            do {
                let info = try await Purchases.shared.restorePurchases()
                let active = info.entitlements[args.entitlementId]?.isActive == true
                invoke.resolve(RestoreOutcome(ok: true, active: active))
            } catch {
                invoke.resolve(RestoreOutcome(
                    ok: false, active: false, error: error.localizedDescription))
            }
        }
    }

    private static func isCancellation(_ error: Error) -> Bool {
        if let code = error as? RevenueCat.ErrorCode {
            return code == .purchaseCancelledError
        }
        let ns = error as NSError
        return ns.domain == RevenueCat.ErrorCode.errorDomain
            && ns.code == RevenueCat.ErrorCode.purchaseCancelledError.rawValue
    }
}

@_cdecl("init_plugin_purchases")
func initPlugin() -> Tauri.Plugin {
    return PurchasesPlugin()
}
