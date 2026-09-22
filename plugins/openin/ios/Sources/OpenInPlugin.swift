// Open in…: the whole native half. One command, one share sheet.
//
// Tauri dispatches a command by building the selector `<command>:` from the
// name Rust passed to run_mobile_plugin, so the entry point carries an explicit
// Objective-C selector matching the snake_case command name while keeping a
// Swift-shaped method name.
//
// Everything below the argument parse runs on the main queue. UIKit is a
// main-thread API and the IPC dispatch queue is not it: reading
// UIApplication.shared.connectedScenes from anywhere else is the kind of thing
// that works until it does not.

import Foundation
import Tauri
import UIKit

/// Arguments of `open_in`. An absolute path inside the container; the frontend
/// builds it from appDataDir. Decodable with no key strategy, so the property
/// name has to be literally what Rust serialises.
class OpenInArgs: Decodable {
    let path: String
}

class OpenInPlugin: Plugin {
    @objc(open_in:)
    public func openIn(_ invoke: Invoke) {
        let args: OpenInArgs
        do {
            args = try invoke.parseArgs(OpenInArgs.self)
        } catch {
            invoke.reject("That file path did not parse: \(error)")
            return
        }

        // fileURLWithPath rather than URL(string:): the path is a filesystem
        // path, and a container path holds spaces and the occasional character
        // a URL parser would refuse.
        let url = URL(fileURLWithPath: args.path)

        DispatchQueue.main.async {
            guard let presenter = OpenInPlugin.topViewController() else {
                invoke.reject("There is no screen to show the share sheet on.")
                return
            }

            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)

            // On an iPad — and on an iPhone in the sizes that get the popover
            // presentation — UIKit raises rather than guessing where the sheet
            // came from, so an anchor is not optional. The centre of the
            // presenting view with no arrow is the honest answer: the control
            // that opened this lives in the top bar of a webview, and UIKit has
            // no way to know where that is.
            if let popover = sheet.popoverPresentationController {
                let bounds = presenter.view.bounds
                popover.sourceView = presenter.view
                popover.sourceRect = CGRect(x: bounds.midX, y: bounds.midY, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }

            // Resolved when the sheet is up, not when the reader has chosen
            // something: what they pick, and whether they dismiss it, is never
            // reported back.
            presenter.present(sheet, animated: true) {
                invoke.resolve()
            }
        }
    }

    /// The view controller a modal can actually be presented from: the deepest
    /// one already on screen. Presenting from the root while something else is
    /// up is the classic "attempt to present … which is already presenting"
    /// — and on this app the lesson's own sheets are exactly that something.
    ///
    /// Main thread only.
    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        guard let windows = scene?.windows else { return nil }
        guard let window = windows.first(where: { $0.isKeyWindow }) ?? windows.first else {
            return nil
        }
        var top = window.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}

@_cdecl("init_plugin_openin")
func initPlugin() -> Plugin {
    return OpenInPlugin()
}
