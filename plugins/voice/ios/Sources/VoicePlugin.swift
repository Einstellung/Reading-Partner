// The command surface of on-device dictation (docs/15). Everything here is
// argument parsing, one-run-at-a-time bookkeeping and event emission; the audio
// and recognition work is in DictationRun.swift.
//
// Tauri dispatches a command by building the selector `<command>:` from the
// name Rust passed to run_mobile_plugin, so each entry point carries an
// explicit Objective-C selector matching the snake_case command name while
// keeping a Swift-shaped method name.
//
// Every command runs on one serial chain. The composer can issue a start while
// the previous stop is still flushing — that is what its flush timeout makes
// routine — and two runs fighting over the audio session is the one failure that
// leaves a microphone open with nobody listening. `release_microphone` is on it
// for the same reason: it arrives right behind the cancel the composer sends
// when voice mode ends, and it must not take the stack apart underneath it.

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

/// Arguments of `set_indicator_probe`. One name from IndicatorStage; anything
/// else is refused rather than silently rounded to a stage, because the whole
/// answer here is "which step lights the indicator" and a probe that quietly
/// stopped somewhere else would answer the wrong question.
class IndicatorProbeArgs: Decodable {
    let stage: String
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
                // The steps it did reach say where it stopped, which is the
                // whole of what a failed start has to report.
                self.emitTiming(run)
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
            self.emitTiming(run)

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

    /// Voice mode is over: the user went back to the keyboard, left the chat, or
    /// the bar was unmounted under them. Whatever the microphone was keeping for
    /// the next hold goes now, and the orange indicator goes with it — the whole
    /// reason the engine was left standing is that the user was about to speak
    /// again, and they are not.
    ///
    /// Resolves either way. It is the last thing a composer does on its way out
    /// and there is nobody left to show a rejection to.
    @objc(release_microphone:)
    public func releaseMicrophone(_ invoke: Invoke) {
        serial { [weak self] in
            guard let self = self else {
                invoke.resolve()
                return
            }
            // A hold still in flight is torn down first rather than pulled apart
            // from underneath. The chain makes it rare — the composer cancels
            // before it releases — but a press that outlived its bar is exactly
            // the case this command is the last defence for.
            if let previous = self.takeRun() {
                NSLog("RP-DICT voice mode ended with a run still live; stopping it")
                await previous.stop()
            }
            AudioFront.shared.close()
            invoke.resolve()
        }
    }

    /// Park the audio stack at one step and leave it there, so that a person
    /// holding the phone can read the answer off the status bar. Nothing is
    /// transcribed and no audio is kept (AudioFront.setIndicatorProbe).
    ///
    /// On the same serial chain as the three above, because it takes the same
    /// microphone: a probe that came up beside a live hold would measure the
    /// hold.
    @objc(set_indicator_probe:)
    public func setIndicatorProbe(_ invoke: Invoke) {
        let args = try? invoke.parseArgs(IndicatorProbeArgs.self)
        guard let raw = args?.stage, let stage = IndicatorStage(rawValue: raw) else {
            invoke.reject("Unknown indicator stage.")
            return
        }

        serial { [weak self] in
            guard let self = self else {
                invoke.reject("Dictation is not available.")
                return
            }
            // A probe replaces whatever the microphone was doing, including a
            // hold nobody released.
            if let previous = self.takeRun() {
                NSLog("RP-DICT indicator probe while a run was live; stopping the old one")
                await previous.stop()
            }
            do {
                let state = try AudioFront.shared.setIndicatorProbe(stage)
                invoke.resolve(state)
            } catch {
                invoke.reject(DictationError.describe(error))
            }
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
            self.emitTiming(run)
            invoke.resolve()
        }
    }

    // MARK: - Events

    /// The run's own events leave through here, on the main queue. The listener table
    /// inside Tauri's Plugin is a plain dictionary written by registerListener
    /// on the IPC queue and read by trigger; funnelling every emission through
    /// one queue keeps the reads serialised among themselves.
    private func emit(_ payload: JSObject) {
        DispatchQueue.main.async { [weak self] in
            self?.trigger("dictation", data: payload)
        }
    }

    /// The hold's segments, on the same event as everything else this plugin
    /// says and with a kind of its own (DictationTiming.swift). Sent from here
    /// rather than from the run, and after the teardown rather than during it,
    /// for two reasons: the teardown's own steps are only complete once stop()
    /// has returned, and the run's emission gate is shut by then. That gate
    /// exists to keep words out of the wrong hold; this payload has no words in
    /// it, and the bench that reads it keeps one listener for the whole session
    /// rather than one per hold.
    ///
    /// Only the three endings a hold has of its own — stopped, cancelled, or a
    /// start that threw — send one. A run torn down because something else
    /// wanted the microphone does not: its numbers would arrive after the next
    /// press and be written down against it.
    private func emitTiming(_ run: DictationRun) {
        let event = DictationTimingEvent(timing: run.timingReport())
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            // Encodable rather than a JSObject: the payload is nested, and the
            // JSON encoder is the one path that does not have to be trusted to
            // coerce a dictionary of dictionaries correctly.
            try? self.trigger("dictation", data: event)
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
