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
///
/// `name` is the display file name, extension included, the reader should see.
/// The library stores a book under its content hash, so handing the file over
/// where it lies names it with 64 hex characters in every app it reaches.
/// Absent, the file is handed over as it is.
class OpenInArgs: Decodable {
    let path: String
    let name: String?
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
        let source = URL(fileURLWithPath: args.path)

        // The copy that carries the reader's name, when there is one to make.
        // Held apart from the URL handed over so that only a file this call
        // created is ever deleted.
        let temporary = OpenInPlugin.component(args.name).flatMap {
            OpenInPlugin.copyToTemporary(source, as: $0)
        }
        let url = temporary ?? source

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

            // The copy lives as long as the sheet does. The handler runs on
            // dismissal whether or not the reader picked anything, and by then
            // whoever received the file has taken its own copy.
            if let temporary {
                sheet.completionWithItemsHandler = { _, _, _, _ in
                    try? FileManager.default.removeItem(at: temporary)
                }
            }

            // Resolved when the sheet is up, not when the reader has chosen
            // something: what they pick, and whether they dismiss it, is never
            // reported back.
            presenter.present(sheet, animated: true) {
                invoke.resolve()
            }
        }
    }

    /// One path component, or nil when there is nothing usable. The frontend
    /// already folds and shortens the name, but this is what turns it into a
    /// filesystem path, and a separator or a control character here would write
    /// somewhere other than where the name reads.
    private static func component(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let illegal = CharacterSet(charactersIn: "/\\:").union(.controlCharacters)
        let cleaned = raw.components(separatedBy: illegal).joined(separator: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        // "." and ".." name a directory, not a file in it.
        guard !cleaned.isEmpty, !cleaned.allSatisfy({ $0 == "." }) else { return nil }
        return cleaned
    }

    /// `source` copied into a temporary directory under `name`, or nil when the
    /// copy did not happen. Nil is not an error: the caller hands the original
    /// over instead, and a file under an ugly name beats no file at all.
    private static func copyToTemporary(_ source: URL, as name: String) -> URL? {
        let fm = FileManager.default
        let dir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("openin", isDirectory: true)
        let destination = dir.appendingPathComponent(name)
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            // copyItem onto an existing file throws, and the same book handed
            // over twice lands on the same name.
            if fm.fileExists(atPath: destination.path) {
                try fm.removeItem(at: destination)
            }
            try fm.copyItem(at: source, to: destination)
        } catch {
            return nil
        }
        return destination
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
