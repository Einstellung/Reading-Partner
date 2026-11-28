// Sign in with Apple: the native half. One command, one system sheet, and an
// identity token back for the Supabase id_token exchange (docs/platform/713).
//
// `sign_in` never rejects. Every outcome resolves as { ok, idToken?, cancelled?,
// error? }, so the frontend tells "the user closed the sheet" apart from a
// failure without parsing error strings.
//
// The nonce arrives already hashed (SHA-256, hex). The frontend keeps the raw
// one and hands it to Supabase, which hashes it again and compares it with the
// `nonce` claim Apple puts in the token.
//
// Without the `com.apple.developer.applesignin` entitlement this compiles and
// the request fails at run time with ASAuthorizationError; nothing calls it
// until the feature is turned on.

import AuthenticationServices
import Foundation
import Tauri
import UIKit

class SignInArgs: Decodable {
    let nonce: String
}

/// What `sign_in` resolves with. Nil fields are left out of the JSON.
struct SignInResult: Encodable {
    let ok: Bool
    var idToken: String? = nil
    var cancelled: Bool? = nil
    var error: String? = nil
}

class AppleSignInPlugin: Plugin {
    // The controller holds its delegate weakly, so the request in flight is
    // kept alive here until it reports back. Main queue only.
    private var pending: AppleSignInRequest?

    @objc(sign_in:)
    public func signIn(_ invoke: Invoke) {
        let args: SignInArgs
        do {
            args = try invoke.parseArgs(SignInArgs.self)
        } catch {
            invoke.resolve(SignInResult(ok: false, error: "The sign-in request did not parse: \(error)"))
            return
        }

        DispatchQueue.main.async {
            if self.pending != nil {
                invoke.resolve(SignInResult(ok: false, error: "A sign-in is already in progress."))
                return
            }
            guard let window = AppleSignInPlugin.keyWindow() else {
                invoke.resolve(SignInResult(ok: false, error: "There is no screen to show Sign in with Apple on."))
                return
            }

            let request = ASAuthorizationAppleIDProvider().createRequest()
            // No full name: the account keeps no names (docs/platform/665).
            request.requestedScopes = [.email]
            request.nonce = args.nonce

            let controller = ASAuthorizationController(authorizationRequests: [request])
            let handler = AppleSignInRequest(controller: controller, window: window) { [weak self] result in
                self?.pending = nil
                invoke.resolve(result)
            }
            controller.delegate = handler
            controller.presentationContextProvider = handler
            self.pending = handler
            controller.performRequests()
        }
    }

    /// The foreground scene's key window, which the system sheet is anchored to.
    /// Main thread only.
    private static func keyWindow() -> UIWindow? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        guard let windows = scene?.windows else { return nil }
        return windows.first(where: { $0.isKeyWindow }) ?? windows.first
    }
}

/// One authorization in flight: delegate and presentation anchor for its
/// controller, and the callback that resolves the invoke exactly once.
final class AppleSignInRequest: NSObject, ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding
{
    private let controller: ASAuthorizationController
    private let window: UIWindow
    private var finish: ((SignInResult) -> Void)?

    init(controller: ASAuthorizationController, window: UIWindow, finish: @escaping (SignInResult) -> Void) {
        self.controller = controller
        self.window = window
        self.finish = finish
    }

    private func done(_ result: SignInResult) {
        let callback = finish
        finish = nil
        callback?(result)
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return window
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
            let data = credential.identityToken,
            let token = String(data: data, encoding: .utf8)
        else {
            done(SignInResult(ok: false, error: "Apple returned no identity token."))
            return
        }
        done(SignInResult(ok: true, idToken: token))
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            done(SignInResult(ok: false, cancelled: true))
            return
        }
        done(SignInResult(ok: false, error: error.localizedDescription))
    }
}

@_cdecl("init_plugin_apple_sign_in")
func initPlugin() -> Plugin {
    return AppleSignInPlugin()
}
