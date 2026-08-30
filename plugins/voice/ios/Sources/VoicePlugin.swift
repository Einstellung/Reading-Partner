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

/// Arguments of `enqueue_speech`, which Rust calls once per sentence as the
/// vendor finishes it. `pcm` is base64 on the wire and JSONDecoder turns it back
/// into bytes with no help, and it is already trimmed: the threshold is a
/// property of the vendor's audio (docs/pitfall/191), so the cut is made in
/// src/tts/trim.rs. The rest is the whole of what Swift needs to know about a
/// sentence. No text: the native side's log has never contained a word anybody
/// said and this does not start.
class EnqueueSpeechArgs: Decodable {
    let utterance: UInt64
    let index: Int
    let chars: Int
    let last: Bool
    let sampleRate: Double
    let pcm: Data
}

/// Arguments of `finish_speech`. The turn and nothing else: the call says that
/// turn has no more sentences, and carrying the number is what stops a call made
/// about a turn the player has already left from ending the one after it.
class FinishSpeechArgs: Decodable {
    let utterance: UInt64
}

/// Arguments of `stop_speaking`. The reason is written into the measurement
/// record and sent out with the `speaking:false` event.
class StopSpeakingArgs: Decodable {
    let reason: String?
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

    /// Wires the playback path's event sender the moment the plugin exists, so
    /// that a `speech` event can never be produced by something with nowhere to
    /// send it.
    override init() {
        super.init()
        // Debug only, and the first thing the native half does: it is the line
        // that says the process got as far as loading its plugins, and after it
        // every lifecycle transition is on the console too.
        SpeechProbe.watchLifecycle()
        SpeechOut.shared.setEmitter { [weak self] kind, value, reason in
            self?.emitSpeech(kind: kind, value: value, reason: reason)
        }
    }

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
            // The voice goes with the microphone: they are one engine, and an
            // engine about to be torn down cannot go on speaking through.
            SpeechOut.shared.stop(reason: "released")
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

    // MARK: - Speaking

    /// One sentence onto the back of the playback queue.
    ///
    /// Called from Rust, never from the webview: the PCM would otherwise cross
    /// the bridge twice and be held in the webview's heap for no reason.
    /// Resolves as soon as the sentence is queued — the answer says how much
    /// speech is now ahead of the listener, which is what the synthesiser needs
    /// to decide whether to keep running ahead.
    @objc(enqueue_speech:)
    public func enqueueSpeech(_ invoke: Invoke) {
        let args: EnqueueSpeechArgs
        do {
            args = try invoke.parseArgs(EnqueueSpeechArgs.self)
        } catch {
            invoke.reject("That sentence did not parse: \(DictationError.describe(error))")
            return
        }

        serial {
            do {
                let ack = try SpeechOut.shared.enqueue(
                    pcm: args.pcm, sampleRate: args.sampleRate, chars: args.chars,
                    utterance: args.utterance, index: args.index, last: args.last)
                invoke.resolve(ack)
            } catch {
                invoke.reject(DictationError.describe(error))
            }
        }
    }

    /// That turn has no more sentences coming.
    ///
    /// Called from Rust, like the enqueue above, and only when the turn's last
    /// sentence never came back from the vendor: the flag that says a turn ended
    /// rides on the audio, and a turn whose end was never synthesised has no
    /// audio to put it on. Queues nothing and stops nothing — what is already
    /// queued plays to the end, and the player falls silent on its own.
    @objc(finish_speech:)
    public func finishSpeech(_ invoke: Invoke) {
        let args: FinishSpeechArgs
        do {
            args = try invoke.parseArgs(FinishSpeechArgs.self)
        } catch {
            invoke.reject("That turn did not parse: \(DictationError.describe(error))")
            return
        }

        serial {
            SpeechOut.shared.finish(utterance: args.utterance)
            invoke.resolve()
        }
    }

    /// Cut the voice off and say where it got to. The position is read before
    /// the player is stopped, because stopping it resets the timeline the
    /// position is measured on.
    @objc(stop_speaking:)
    public func stopSpeaking(_ invoke: Invoke) {
        let args = try? invoke.parseArgs(StopSpeakingArgs.self)
        let reason = args?.reason ?? "interrupted"
        serial {
            let position = SpeechOut.shared.stop(reason: reason)
            invoke.resolve(position)
        }
    }

    /// The bench: play the fixture on the device's own disk through the same
    /// path a real turn takes. Resolves the moment the run is started, never
    /// when it finishes — a command that waited out seventy-five seconds of
    /// speech would hold the serial chain for all of it (docs/pitfall/159).
    @objc(speech_probe:)
    public func speechProbe(_ invoke: Invoke) {
        SpeechProbe.holdTheScreen()
        let args: SpeechProbeArgs
        do {
            args = try invoke.parseArgs(SpeechProbeArgs.self)
        } catch {
            invoke.reject("That probe did not parse: \(DictationError.describe(error))")
            return
        }

        // A breadcrumb for the device console, carried in `label`. Answered
        // here rather than in the chain: a note queued behind a seventy-five
        // second leg is not a breadcrumb.
        if args.mode == "note" {
            SpeechProbe.note(args.label)
            invoke.resolve()
            return
        }

        serial {
            do {
                if args.mode == "vpio" {
                    // Only the unit gets switched. The stack goes with it, and
                    // returning here rather than doing it at the head of a leg
                    // is what keeps that teardown's own `lost` from landing
                    // inside a leg that has already started listening.
                    SpeechProbe.setVoiceProcessing(args.vpio)
                    invoke.resolve()
                } else if args.mode == "capture" {
                    // Arms a tape for a leg that plays from somewhere else.
                    SpeechProbe.armCapture(args)
                    invoke.resolve()
                } else if args.mode == "route" {
                    // Which category options actually get the audio to a
                    // headset, and whether the voice-processing unit survives
                    // the route they produce. Runs before the first leg, while
                    // the stack is still down.
                    invoke.resolve(SpeechRouteReport(trials: SpeechProbe.surveyRoutes()))
                } else if args.mode == "interrupt" {
                    let positions = try SpeechProbe.interrupt(
                        args, afterMs: args.afterMs ?? 5, times: args.times ?? 50)
                    invoke.resolve(SpeechInterruptReport(positions: positions))
                } else if let mode = args.mode, mode.hasPrefix("turn-") {
                    // The turn probe (SpeechProbe.swift, "The turn probe"): four
                    // steps of one pass, each its own command because the
                    // stretches between them are a person speaking and a phone
                    // playing, and only the harness knows when those begin and
                    // end. `turn-start` returns as soon as the microphone is
                    // open; the pass runs until `turn-stop`.
                    //
                    // On the serial chain like everything else here: a pass and
                    // a hold cannot share a microphone, and the fixture playback
                    // the stages ask for arrives on this same chain.
                    //
                    // `turn-replay` is not one of the four. It opens nothing and
                    // measures nothing — recorded levels through the ported turn
                    // detector, answered from arithmetic.
                    #if DEBUG
                        switch mode {
                        case "turn-start":
                            try await TurnProbe.shared.start(
                                label: args.label, locale: args.locale,
                                sensitivity: args.sensitivity ?? "medium",
                                report: args.reportResults ?? true)
                            invoke.resolve()
                        case "turn-stage":
                            TurnProbe.shared.stage(args.stage ?? args.label)
                            invoke.resolve()
                        case "turn-finalize":
                            // Resolves with how long the call took. The words it
                            // produced arrive on the results stream and are in
                            // the report, not in this answer.
                            let ms = await TurnProbe.shared.finalizeNow()
                            invoke.resolve(TurnFinalizeReport(callMs: ms))
                        case "turn-stop":
                            invoke.resolve(await TurnProbe.shared.stop())
                        case "turn-replay":
                            // Not a pass and not a measurement: recorded levels
                            // through the ported turn detector and back, which
                            // is how src/smoke/turn-replay.ts checks
                            // VoiceTurn.swift against turn-detect.ts. No
                            // microphone, so it does not care what else has run.
                            invoke.resolve(
                                TurnReplay.run(
                                    label: args.label, frames: args.frames ?? [],
                                    config: args.turnConfig))
                        default:
                            invoke.reject("Unknown turn probe step \(mode).")
                        }
                    #else
                        invoke.reject("\(mode) is a debug build's tool.")
                    #endif
                } else {
                    try SpeechProbe.start(args)
                    invoke.resolve()
                }
            } catch {
                invoke.reject(DictationError.describe(error))
            }
        }
    }

    /// What the last run measured, and the moment the tape is written to disk.
    /// Called after the run has stopped, which is what the `speaking:false`
    /// event tells the bench.
    @objc(speech_report:)
    public func speechReport(_ invoke: Invoke) {
        serial {
            #if DEBUG
                SpeechOut.shared.flushCapture()
            #endif
            invoke.resolve(SpeechOut.shared.report())
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

    /// The playback path's own event, on an event name of its own.
    ///
    /// Not a fifth kind on `dictation`: the composer's reducer over that union
    /// has no default branch (src/ai/voice/dictation.ts), and the run's emission
    /// gate is what keeps a hold from hearing the previous hold's words. A
    /// second name costs nothing on either side — Swift's `trigger` fans out by
    /// name and the listener registry is keyed by the name the webview passed —
    /// and it leaves every promise the dictation event makes untouched.
    private func emitSpeech(kind: String, value: Double, reason: String?) {
        var payload = JSObject()
        payload["kind"] = kind
        payload["value"] = value
        if let reason = reason { payload["reason"] = reason }
        DispatchQueue.main.async { [weak self] in
            self?.trigger("speech", data: payload)
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
