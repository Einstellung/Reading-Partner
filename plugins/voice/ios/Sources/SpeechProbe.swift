// The bench's driver: twelve pre-synthesised sentences off the device's own
// disk, fed through SpeechOut exactly the way the Rust TTS client will feed it,
// with no network in the loop. Debug builds only — a shipping build has no
// fixture to read and nothing to write a tape to.
//
// Playing files rather than synthesising is the whole point. Every question the
// device experiments ask (does the seam splice, does playerTime tell the truth,
// does the echo canceller keep our own voice out of the transcript, is the
// envelope usable) is about the player and the engine, and a vendor's latency
// jitter in the middle of it would be noise. The one leg that is about arrival
// timing replays the fixture's own measured synthesis times.

import AVFoundation
import Foundation
#if canImport(UIKit)
    import UIKit
#endif

struct SpeechProbeArgs: Decodable {
    let label: String
    /// Which copy of the fixture to feed: `trimmed`, which is what a real turn
    /// hands over, or `raw`, the vendor's own bytes with their silences left in.
    /// Two files, not a switch: nothing on this side trims (docs/pitfall/191).
    let source: String
    /// `burst` queues everything at once; `measured` waits out each sentence's
    /// real synthesis time from the manifest first.
    let pace: String
    /// Force the voice-processing unit on or off for this run. Absent leaves the
    /// app's own behaviour, which is on.
    let vpio: Bool?
    /// Absolute path of the fixture directory, resolved by the webview: it knows
    /// where Tauri's app data directory is and Swift would have to guess.
    let fixtureDir: String
    /// Where to write the player's own output as 16-bit PCM. Absent writes none.
    let capturePath: String?
    /// Only the first N sentences, for the shorter legs.
    let limit: Int?
    /// `play` (the default) feeds the fixture; `interrupt` runs the
    /// queue-then-stop loop below.
    let mode: String?
    let afterMs: Double?
    let times: Int?
}

/// One sentence as the manifest describes it.
private struct FixtureSentence: Decodable {
    struct Synth: Decodable {
        let total_ms: Double
    }
    let index: Int
    let id: String
    let chars: Int
    let synth: Synth
}

private struct FixtureManifest: Decodable {
    let sentences: [FixtureSentence]
}

enum SpeechProbe {
    /// Reads the manifest, then feeds the sentences. Returns as soon as the
    /// first one is queued: the command that calls this resolves immediately and
    /// the run is watched through the `speech` event, because a command that
    /// waited out seventy-five seconds of speech would hold the serial chain for
    /// all of it (docs/pitfall/159).
    /// The stack is rebuilt whenever a leg wants a different unit than the one
    /// standing, because a leg that inherited the wrong one would answer a
    /// question nobody asked. The teardown is asynchronous and ends in a
    /// `speaking:0` carrying `lost`, so a leg that cares switches before it
    /// starts watching rather than on its way in.
    static func setVoiceProcessing(_ vpio: Bool?) {
        guard let vpio = vpio, AudioFront.voiceProcessingOverride != vpio else { return }
        AudioFront.voiceProcessingOverride = vpio
        AudioFront.shared.close()
    }

    // MARK: - Route survey

    /// One combination tried, and what the system did with it.
    struct RouteTrial: Encodable {
        let name: String
        /// The whole route line: category, mode, options, both halves of the
        /// route with names, the sample rate and what else was on offer. The
        /// rate is what says which Bluetooth profile came up — HFP runs at 8 or
        /// 16 kHz, A2DP at 44.1 or 48.
        let route: String
        /// Whether the category could be set at all with these options.
        let configured: Bool
        /// Whether the voice-processing unit could be turned on over that route
        /// and an engine started through it. This is the half that decides
        /// whether asymmetric routing (A2DP out, built-in microphone in) is a
        /// real option or only a nice idea.
        let voiceProcessing: Bool
        let error: String?
    }

    /// What the phone actually does with each set of category options, measured
    /// rather than read off the documentation. The shipping configuration asks
    /// for `.playAndRecord` + `.voiceChat` + `.defaultToSpeaker` and no Bluetooth
    /// option at all, so a paired headset gets no playback; whether asking for
    /// A2DP changes that, and what it costs, is not answerable from the code.
    ///
    /// Runs on its own session, before the stack is up, and leaves the session
    /// inactive behind it. Debug only.
    static func surveyRoutes() -> [RouteTrial] {
        #if DEBUG
            let session = AVAudioSession.sharedInstance()
            let beforeMode = session.mode
            let beforeOptions = session.categoryOptions
            var out: [RouteTrial] = []
            let combos: [(String, AVAudioSession.Mode, AVAudioSession.CategoryOptions)] = [
                ("shipping", .voiceChat, [.defaultToSpeaker]),
                ("voiceChat+hfp", .voiceChat, [.allowBluetooth]),
                ("voiceChat+a2dp", .voiceChat, [.allowBluetoothA2DP]),
                ("voiceChat+a2dp+speaker", .voiceChat, [.allowBluetoothA2DP, .defaultToSpeaker]),
                ("default+a2dp", .default, [.allowBluetoothA2DP]),
                ("videoChat+a2dp", .videoChat, [.allowBluetoothA2DP]),
            ]
            for (name, mode, options) in combos {
                var configured = false
                var vp = false
                var failure: String? = nil
                do {
                    try session.setCategory(.playAndRecord, mode: mode, options: options)
                    try session.setActive(true)
                    configured = true
                } catch {
                    failure = DictationError.describe(error)
                }
                if configured {
                    // A scratch engine, so that nothing here can leave the real
                    // one in a state a leg would inherit. Torn down before the
                    // next combination is asked for.
                    let engine = AVAudioEngine()
                    let input = engine.inputNode
                    do {
                        try input.setVoiceProcessingEnabled(true)
                        // Something has to consume the input or the engine has
                        // no reason to run the IO unit.
                        let format = input.outputFormat(forBus: 0)
                        input.installTap(onBus: 0, bufferSize: 1024, format: format) { _, _ in }
                        engine.prepare()
                        try engine.start()
                        vp = engine.isRunning
                    } catch {
                        failure = (failure.map { $0 + "; " } ?? "") + DictationError.describe(error)
                    }
                    // The order that does not abort: the tap first, then the
                    // engine, and no detaching of anything (docs/pitfall/198).
                    input.removeTap(onBus: 0)
                    engine.stop()
                }
                let line = describeRoute(session)
                out.append(
                    RouteTrial(
                        name: name, route: line, configured: configured,
                        voiceProcessing: vp, error: failure))
                NSLog("RP-SPEECH route %@ vp=%d %@", name, vp ? 1 : 0, line)
            }
            // Put the session back the way it was found and let go of it, so the
            // first leg configures from the same place it always has.
            try? session.setCategory(.playAndRecord, mode: beforeMode, options: beforeOptions)
            try? session.setActive(false, options: [.notifyOthersOnDeactivation])
            return out
        #else
            return []
        #endif
    }

    /// Same wording as SpeechOut's, and for the same reason: a port type alone
    /// does not say whether the headset got the audio.
    private static func describeRoute(_ session: AVAudioSession) -> String {
        let route = session.currentRoute
        let ports = { (list: [AVAudioSessionPortDescription]) in
            list.map { "\($0.portType.rawValue)/\($0.portName)" }.joined(separator: "+")
        }
        let available = (session.availableInputs ?? []).map {
            "\($0.portType.rawValue)/\($0.portName)"
        }.joined(separator: "+")
        return "cat=\(session.category.rawValue) mode=\(session.mode.rawValue) "
            + "opts=\(session.categoryOptions.rawValue) "
            + "out=\(ports(route.outputs)) in=\(ports(route.inputs)) "
            + "rate=\(session.sampleRate) available=\(available)"
    }

    /// The unattended run is minutes long and the phone auto-locks after two,
    /// which backgrounds the app, tears the stack down and ends whichever leg
    /// was running with a `lost` (docs/pitfall/162). The webview's wake lock
    /// cannot cover it: it is refused until something on the page has been
    /// touched, and an unattended run has nobody to touch it. So the idle timer
    /// is held off from here instead, for the life of the process — every entry
    /// into the probe asks for it, including the very first VPIO switch.
    ///
    /// Debug only. A shipping build has no probe to call this and never holds
    /// the user's screen awake.
    static func holdTheScreen() {
        #if DEBUG && canImport(UIKit)
            DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = true }
        #endif
    }

    /// Says on the device console that the native half came up, and then says
    /// every time the app changes lifecycle state. Two device runs ended with
    /// no result file, no crash report and no process, and nothing on either
    /// side could say whether the webview had ever started or whether something
    /// had put the app in the background. One `NSLog` per transition answers
    /// both, and `idevicesyslog -p 'Reading Partner'` is where it is read.
    ///
    /// Debug only, and idempotent: the plugin is constructed once, but a second
    /// call would otherwise register a second set of observers.
    static func watchLifecycle() {
        #if DEBUG && canImport(UIKit)
            guard !watching else { return }
            watching = true
            NSLog("RP-SPEECH native up")
            let names: [(Notification.Name, String)] = [
                (UIApplication.didFinishLaunchingNotification, "didFinishLaunching"),
                (UIApplication.didBecomeActiveNotification, "didBecomeActive"),
                (UIApplication.willResignActiveNotification, "willResignActive"),
                (UIApplication.didEnterBackgroundNotification, "didEnterBackground"),
                (UIApplication.willEnterForegroundNotification, "willEnterForeground"),
                (UIApplication.willTerminateNotification, "willTerminate"),
                (UIApplication.didReceiveMemoryWarningNotification, "memoryWarning"),
            ]
            for (name, label) in names {
                NotificationCenter.default.addObserver(
                    forName: name, object: nil, queue: .main
                ) { _ in NSLog("RP-SPEECH lifecycle %@", label) }
            }
        #endif
    }

    #if DEBUG && canImport(UIKit)
        private static var watching = false
    #endif

    /// A line on the console from the webview, so that the JavaScript half of
    /// the run leaves the same trail the native half does. `console.log` in a
    /// WKWebView reaches nothing a cable can read.
    static func note(_ text: String) {
        #if DEBUG
            NSLog("RP-SPEECH %@", text)
        #endif
    }

    /// Arm the tape without playing anything. The live leg is driven from Rust
    /// and never comes through `start`, so without this it is the one leg that
    /// leaves no recording — and it is the only leg with the relay's own gaps
    /// between sentences in it, which is what someone listening has to hear.
    /// `speech_report` flushes it, exactly as it does for the fixture legs.
    static func armCapture(_ args: SpeechProbeArgs) {
        SpeechOut.shared.setLabel(args.label)
        #if DEBUG
            if let path = args.capturePath {
                // Longer than the fixture legs' 120 s: this one waits on a
                // vendor between sentences and the tap runs through the waits.
                SpeechOut.shared.beginCapture(label: args.label, path: path, seconds: 200)
            } else {
                SpeechOut.shared.endCapture()
            }
        #endif
    }

    static func start(_ args: SpeechProbeArgs) throws {
        let dir = URL(fileURLWithPath: args.fixtureDir)
        let manifestData = try Data(contentsOf: dir.appendingPathComponent("manifest.json"))
        let manifest = try JSONDecoder().decode(FixtureManifest.self, from: manifestData)
        var sentences = manifest.sentences.sorted { $0.index < $1.index }
        if let limit = args.limit { sentences = Array(sentences.prefix(limit)) }
        guard !sentences.isEmpty else {
            throw DictationError("The fixture manifest has no sentences in it.")
        }

        setVoiceProcessing(args.vpio)

        SpeechOut.shared.setLabel(args.label)
        #if DEBUG
            if let path = args.capturePath {
                // 120 s of headroom over a 75 s fixture, allocated up front so
                // the audio thread never does.
                SpeechOut.shared.beginCapture(label: args.label, path: path, seconds: 120)
            } else {
                SpeechOut.shared.endCapture()
            }
        #endif

        let measured = args.pace == "measured"
        let turn = UInt64(Date().timeIntervalSince1970 * 1000)

        Task.detached(priority: .userInitiated) {
            var elapsed: Double = 0
            let began = CFAbsoluteTimeGetCurrent()
            for (position, sentence) in sentences.enumerated() {
                if measured {
                    elapsed += sentence.synth.total_ms
                    let wait = elapsed / 1000 - (CFAbsoluteTimeGetCurrent() - began)
                    if wait > 0 {
                        try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
                    }
                }
                let file = dir.appendingPathComponent(args.source)
                    .appendingPathComponent("\(sentence.id).pcm")
                guard let pcm = try? Data(contentsOf: file) else {
                    SpeechOut.shared.fail("The fixture is missing \(file.path).")
                    return
                }
                do {
                    let ack = try SpeechOut.shared.enqueue(
                        pcm: pcm, sampleRate: SpeechOut.sampleRate, chars: sentence.chars,
                        utterance: turn, index: sentence.index,
                        last: position == sentences.count - 1)
                    if ack.dropped { return }
                } catch {
                    SpeechOut.shared.fail(DictationError.describe(error))
                    return
                }
            }
        }
    }

    /// The interruption leg: queue a sentence and cut it off after `afterMs`,
    /// `times` over. What it is looking for is the process surviving a `stop()`
    /// that lands before the player has finished a single IO cycle.
    static func interrupt(_ args: SpeechProbeArgs, afterMs: Double, times: Int) throws
        -> [SpeechPosition]
    {
        let dir = URL(fileURLWithPath: args.fixtureDir)
        let manifestData = try Data(contentsOf: dir.appendingPathComponent("manifest.json"))
        let manifest = try JSONDecoder().decode(FixtureManifest.self, from: manifestData)
        guard let first = manifest.sentences.sorted(by: { $0.index < $1.index }).first else {
            throw DictationError("The fixture manifest has no sentences in it.")
        }
        let pcm = try Data(
            contentsOf: dir.appendingPathComponent(args.source)
                .appendingPathComponent("\(first.id).pcm"))

        var positions: [SpeechPosition] = []
        // Turns are wall-clock milliseconds everywhere else in this file, and
        // the player drops a sentence whose turn is older than the last one it
        // saw. A counter starting at 1 is older than every leg that ran before
        // this one, which is how fifty interruptions came to be fifty drops.
        let base = UInt64(Date().timeIntervalSince1970 * 1000)
        for round in 0..<times {
            let turn = base &+ UInt64(round)
            _ = try SpeechOut.shared.enqueue(
                pcm: pcm, sampleRate: SpeechOut.sampleRate, chars: first.chars, utterance: turn,
                index: first.index, last: true)
            Thread.sleep(forTimeInterval: afterMs / 1000)
            positions.append(SpeechOut.shared.stop(reason: "interrupt"))
        }
        return positions
    }
}

/// The interruption leg's answer. A struct rather than a dictionary because the
/// invoke encoder takes an Encodable whole and would have to be trusted to
/// coerce an array of them nested in one.
struct SpeechInterruptReport: Encodable {
    let positions: [SpeechPosition]
}

/// What every set of category options did to the route.
struct SpeechRouteReport: Encodable {
    let trials: [SpeechProbe.RouteTrial]
}
