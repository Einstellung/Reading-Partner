// The command surface of on-device dictation (docs/15). Everything here is
// argument parsing, one-run-at-a-time bookkeeping and event emission; the audio
// and recognition work is in DictationRun.swift.
//
// Tauri dispatches a command by building the selector `<command>:` from the
// name Rust passed to run_mobile_plugin, so each entry point carries an
// explicit Objective-C selector matching the snake_case command name while
// keeping a Swift-shaped method name.
//
// The three commands run on one serial chain. The composer can issue a start
// while the previous stop is still flushing — that is what its flush timeout
// makes routine — and two runs fighting over the audio session is the one
// failure that leaves a microphone open with nobody listening.

import AVFoundation
import Foundation
import Speech
import Tauri

/// Arguments of `start_dictation`. Both are optional and both are usually
/// *absent* rather than null: the invoke payload is JSON.stringify'd, undefined
/// properties vanish, and the composer passes neither on a book with no
/// glossary. Decodable with no key strategy, so the property name has to be
/// literally what Rust serialises.
class StartDictationArgs: Decodable {
    let locale: String?
    let contextualStrings: [String]?
}

class VoicePlugin: Plugin {
    /// The live run, if any. Touched from the IPC dispatch queue and from the
    /// Tasks the commands spawn, so every access goes through the lock.
    private var run: DictationRun?
    private let runLock = NSLock()

    /// The tail of the serial chain. Each command appends itself and waits for
    /// whatever is ahead of it.
    private var chain: Task<Void, Never> = Task {}
    private let chainLock = NSLock()

    private func serial(_ body: @escaping () async -> Void) {
        chainLock.lock()
        let previous = chain
        chain = Task {
            await previous.value
            await body()
        }
        chainLock.unlock()
    }

    // MARK: - Commands

    @objc(start_dictation:)
    public func startDictation(_ invoke: Invoke) {
        // Missing arguments are the normal case, so a parse that fails is a
        // plain start, not a failure.
        let args = try? invoke.parseArgs(StartDictationArgs.self)
        let locale = args?.locale
        let hints = args?.contextualStrings ?? []

        serial { [weak self] in
            guard let self = self else {
                invoke.reject("Dictation is not available.")
                return
            }

            // A start that arrives with a run still live replaces it. The chain
            // makes this rare — it means the previous hold's stop never came —
            // but a second engine on the same session is worse than a lost run.
            if let previous = self.takeRun() {
                NSLog("RP-DICT start while a run was live; stopping the old one")
                await previous.stop()
            }

            let run = DictationRun { [weak self] payload in
                self?.emit(payload)
            }
            do {
                try await run.start(locale: locale, contextualStrings: hints)
            } catch {
                // Tear the half-built run down before answering, so the audio
                // session is not left active behind a failed start.
                await run.stop()
                invoke.reject(DictationError.describe(error))
                return
            }
            self.setRun(run)
            invoke.resolve()
            // Only now: the composer sits in `arming` until this response lands
            // and drops every event that arrives first.
            run.beginEmitting()
        }
    }

    @objc(stop_dictation:)
    public func stopDictation(_ invoke: Invoke) {
        serial { [weak self] in
            guard let self = self, let run = self.takeRun() else {
                // No run at all is the same answer as a run that heard nothing.
                // The composer owns the sentence for an empty transcript.
                invoke.resolve(["transcript": ""])
                return
            }
            // Before the flush, not after: the listener stays registered for the
            // whole teardown, and on a flush timeout the composer permits a new
            // hold while the old one is still subscribed.
            run.endEmitting()
            await run.stop()

            let transcript = run.transcript()
            // A recognizer that died mid-hold has no other way to say so: the
            // event payload has no error kind. Only reject when there is
            // nothing to hand back, though — words the user already said are
            // theirs, and the composer would discard this message for them
            // anyway the moment anything had streamed.
            if transcript.isEmpty, let failure = run.failureMessage() {
                invoke.reject(failure)
                return
            }
            NSLog("RP-DICT stop transcript=%d chars", transcript.count)
            invoke.resolve(["transcript": transcript])
        }
    }

    @objc(cancel_dictation:)
    public func cancelDictation(_ invoke: Invoke) {
        serial { [weak self] in
            guard let self = self, let run = self.takeRun() else {
                invoke.resolve()
                return
            }
            run.endEmitting()
            await run.stop()
            invoke.resolve()
        }
    }

    // MARK: - Events

    /// The one event leaves through here, on the main queue. The listener table
    /// inside Tauri's Plugin is a plain dictionary written by registerListener
    /// on the IPC queue and read by trigger; funnelling every emission through
    /// one queue keeps the reads serialised among themselves.
    private func emit(_ payload: JSObject) {
        DispatchQueue.main.async { [weak self] in
            self?.trigger("dictation", data: payload)
        }
    }

    // MARK: - Run bookkeeping

    private func setRun(_ value: DictationRun?) {
        runLock.lock()
        run = value
        runLock.unlock()
    }

    private func takeRun() -> DictationRun? {
        runLock.lock()
        defer { runLock.unlock() }
        let current = run
        run = nil
        return current
    }
}

@_cdecl("init_plugin_voice")
func initPlugin() -> Plugin {
    return VoicePlugin()
}
