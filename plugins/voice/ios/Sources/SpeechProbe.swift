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
// CMTime and CMTimeRange, which the turn probe's detector and transcript
// results are stamped with.
import CoreMedia
import Foundation
import Speech
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
    // The turn probe's own knobs. All optional and all absent on every other
    // mode: the invoke payload is JSON.stringify'd and undefined properties
    // vanish, so a leg that does not set one sends no key at all.
    /// `low`, `medium` or `high`. Anything else is medium, which is the level
    /// Apple recommends and the one the other passes are compared against.
    let sensitivity: String?
    /// BCP-47. Not optional in practice: without one the native side walks
    /// `Locale.preferredLanguages` and a Chinese sentence decoded as English
    /// comes back as fluent English nonsense (docs/pitfall/164).
    let locale: String?
    /// The name of the stretch that starts here — `played`, `human`, `duplex`.
    let stage: String?
    /// What `reportResults` is passed to `SpeechDetector`. Absent is true; a
    /// pass with it false is the control that says the silence came from the
    /// flag rather than from the model.
    let reportResults: Bool?
    /// The replay leg's input (SpeechProbe.swift, "The turn detector replay"):
    /// one recorded level per buffer, and the config patch to run them through.
    /// `label` carries the case's name.
    let frames: [TurnReplayFrame]?
    let turnConfig: TurnReplayConfig?
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
            // Also the first thing the webview does that Swift can see, and the
            // console is the only witness left when a run dies without writing
            // its JSON and without leaving a crash report.
            NSLog("RP-SPEECH probe entered")
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

// MARK: - The turn probe
//
// Everything below answers three questions about full duplex and nothing else
// (docs/33, M-voice-3). It is a measuring instrument: it records, it never
// decides. No turn detector, no barge-in, no threshold — those are written
// against the numbers this produces, not inside it.
//
//   1. Does SpeechDetector report anything at all? Apple's own documentation
//      disagrees with itself — Result's abstract says the results "currently
//      only support error handling from the VAD model" while the initializer's
//      says it reports the VAD model's results — and only a device settles it.
//      `detectorEvents == 0` with `detectorStreamEnded` beside it is the answer
//      if the answer is no, and that is a finding, not a failure.
//   2. What does finalize(through: nil) cost, and what does it cost the words?
//      Every call is recorded, and the transcript events around it are in the
//      same list on the same clock, so the wait and the difference are both
//      read off `events`.
//   3. How does the tap actually deliver, and what levels does this placement
//      see? One record per buffer, no throttle and no aggregation: the 15 Hz
//      ceiling and the 0..1 mapping in DictationRun are display decisions and
//      they would destroy the raw distribution a threshold has to be fitted to.
//
// Not shared with DictationRun on purpose. Hold-to-talk is on TestFlight and a
// probe is not a reason to touch it, so the converter and the level maths are
// repeated here rather than lifted out.

/// A one-shot latch with a deadline. The same shape as DictationRun's `Gate`
/// and copied rather than shared for the reason above; Swift cannot abandon an
/// `await` on another task, so the deadline resolves the wait instead of racing
/// it.
private final class ProbeGate {
    private let lock = NSLock()
    private var opened = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func signal() {
        lock.lock()
        opened = true
        let pending = waiters
        waiters = []
        lock.unlock()
        for waiter in pending { waiter.resume() }
    }

    func wait(upToMs: UInt64, onTimeout: (() -> Void)? = nil) async {
        lock.lock()
        let already = opened
        lock.unlock()
        if already { return }

        let timer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: upToMs * 1_000_000)
            if Task.isCancelled { return }
            onTimeout?()
            self?.signal()
        }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            lock.lock()
            if opened {
                lock.unlock()
                continuation.resume()
                return
            }
            waiters.append(continuation)
            lock.unlock()
        }
        timer.cancel()
    }
}

/// One thing that happened, on one clock.
///
/// Every kind goes in the same array in arrival order, because the ordering
/// between kinds is the measurement: a detector result is only worth anything
/// next to the level frames around it, and a forced finalize is only worth
/// anything next to the transcript events that follow it.
struct TurnEvent: Encodable {
    /// Milliseconds since the pass started — `CFAbsoluteTimeGetCurrent` at the
    /// moment the record is made, and the one clock everything here shares.
    let sinceStartMs: Double
    /// `level`, `detector`, `transcript`, `stage`, `finalize` or `log`.
    let kind: String
    let payload: TurnPayload
}

/// The union of everything a `TurnEvent` can carry. One struct with optionals
/// and a hand-written encoding that leaves the absent ones out, rather than a
/// type-erased box: the shape is small and it is read by a person as well as by
/// a parser.
struct TurnPayload: Encodable {
    // level
    /// Linear RMS over the raw microphone samples, before conversion — the same
    /// number DictationRun computes and the same name the earlier probe wrote
    /// (`payload.inputRms`), so the two rounds are comparable. dB is
    /// `20 * log10(inputRms)` and is not stored: a derived column that can
    /// disagree with its source is worse than an arithmetic step.
    var inputRms: Double? = nil
    /// What the tap actually delivered. `bufferSize` is a request, not a
    /// contract (docs/pitfall/161), and this build's delivery rhythm is one of
    /// the three questions.
    var frames: Int? = nil
    /// Where this buffer starts on the microphone's own timeline, counted in
    /// frames from the first buffer of the pass. The analyzer's audio clock has
    /// the same zero, so a detector result's `range` and a level frame's
    /// `audioMs` are directly comparable — which is the whole of question 1.
    var audioMs: Double? = nil

    // detector
    var speechDetected: Bool? = nil

    // detector and transcript
    var isFinal: Bool? = nil
    var rangeStartMs: Double? = nil
    var rangeEndMs: Double? = nil
    var finalizationMs: Double? = nil

    // transcript
    var text: String? = nil

    // stage
    var stage: String? = nil

    // finalize
    var request: Int? = nil
    /// `called` before `finalize(through:)` is awaited, `returned` after.
    var phase: String? = nil
    /// How long the call itself took. Not how long the words took to arrive —
    /// that is the gap to the next `transcript` event carrying `isFinal`, and it
    /// is read off the list.
    var callMs: Double? = nil
    /// The volatile tail standing at the instant of the call. The first version
    /// either sends this or sends what the forced finalize produced, so the two
    /// have to be recorded side by side.
    var volatileAtCall: String? = nil

    // log and failure
    var line: String? = nil
    var error: String? = nil

    enum CodingKeys: String, CodingKey {
        case inputRms, frames, audioMs, speechDetected, isFinal, rangeStartMs, rangeEndMs
        case finalizationMs, text, stage, request, phase, callMs, volatileAtCall, line, error
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(inputRms, forKey: .inputRms)
        try c.encodeIfPresent(frames, forKey: .frames)
        try c.encodeIfPresent(audioMs, forKey: .audioMs)
        try c.encodeIfPresent(speechDetected, forKey: .speechDetected)
        try c.encodeIfPresent(isFinal, forKey: .isFinal)
        try c.encodeIfPresent(rangeStartMs, forKey: .rangeStartMs)
        try c.encodeIfPresent(rangeEndMs, forKey: .rangeEndMs)
        try c.encodeIfPresent(finalizationMs, forKey: .finalizationMs)
        try c.encodeIfPresent(text, forKey: .text)
        try c.encodeIfPresent(stage, forKey: .stage)
        try c.encodeIfPresent(request, forKey: .request)
        try c.encodeIfPresent(phase, forKey: .phase)
        try c.encodeIfPresent(callMs, forKey: .callMs)
        try c.encodeIfPresent(volatileAtCall, forKey: .volatileAtCall)
        try c.encodeIfPresent(line, forKey: .line)
        try c.encodeIfPresent(error, forKey: .error)
    }
}

/// What a forced finalize cost to call. A struct rather than a dictionary
/// literal for the reason the interruption leg's is one: `resolve` takes both a
/// JSObject and an Encodable, and a one-key literal of Doubles is a coin toss
/// between them.
struct TurnFinalizeReport: Encodable {
    let callMs: Double
}

/// What one pass of the turn probe measured.
struct TurnProbeReport: Encodable {
    let label: String
    let ok: Bool
    let error: String?
    /// What was asked for and what was built, so a pass that answers nothing
    /// still says what it was.
    let locale: String
    let sensitivity: String
    let reportResults: Bool
    let voiceProcessing: Bool
    let tapSampleRate: Double
    let analyzerFormat: String
    /// Whether the analyzer accepted a detector module at all. False with an
    /// `error` beside it is already an answer to question 1.
    let detectorAttached: Bool
    /// The count question 1 turns on. Zero over a pass that had speech in it
    /// says the results stream does not exist, whatever the documentation says.
    let detectorEvents: Int
    /// Whether the detector's sequence ended on its own rather than being
    /// cancelled. Zero events over a stream that ended and zero over a stream
    /// still waiting are the same number and not the same finding.
    let detectorStreamEnded: Bool
    let detectorError: String?
    let levelEvents: Int
    /// Everything the recogniser settled on, folded the way DictationRun folds
    /// it. The per-result texts are in `events`; this is the convenience copy.
    let transcript: String
    /// Wall-clock milliseconds at `sinceStartMs == 0`, so a pass lines up
    /// against the device log and against the other passes.
    let startedAtEpochMs: Double
    let events: [TurnEvent]
}

/// The live pass. A singleton because the harness drives it in steps — start,
/// stage, finalize, stop — and each step arrives as its own command.
///
/// Debug builds only: every member is compiled out below and the plugin refuses
/// the mode outright in a shipping build.
final class TurnProbe {
    static let shared = TurnProbe()

    private init() {}

    #if DEBUG

        // MARK: State

        private var transcriber: SpeechTranscriber?
        private var detector: SpeechDetector?
        private var analyzer: SpeechAnalyzer?
        private var resultsTask: Task<Void, Never>?
        private var detectorTask: Task<Void, Never>?
        private let resultsGate = ProbeGate()

        /// Written on the start task, read on the audio thread. Held for the
        /// whole of `feed`, which is a conversion and a yield and costs
        /// microseconds — the same trade DictationRun's pre-roll lock makes on
        /// the same thread.
        private let feedLock = NSLock()
        private var converter: AVAudioConverter?
        private var analyzerFormat: AVAudioFormat?
        private var inputContinuation: AsyncStream<AnalyzerInput>.Continuation?

        private let eventLock = NSLock()
        private var events: [TurnEvent] = []
        private var detectorEvents = 0
        private var levelEvents = 0
        private var detectorStreamEnded = false
        private var detectorError: String?
        private var finals: [String] = []
        private var volatileTail = ""

        /// Frames the tap has delivered, touched on the audio thread only.
        private var framesSeen: UInt64 = 0
        private var tapSampleRate: Double = 0
        private var startedAt: CFAbsoluteTime = 0
        private var startedAtEpochMs: Double = 0
        private var running = false
        private var nextRequest = 0

        private var label = ""
        private var localeTag = ""
        private var sensitivityName = "medium"
        private var reportResults = true
        private var detectorAttached = false
        private var analyzerFormatLine = ""
        private var startError: String?
        private var observers: [NSObjectProtocol] = []

        // MARK: - Start

        /// Builds the recogniser first and opens the microphone last, which is
        /// the opposite of a hold and right for a probe: nobody is speaking
        /// during the start, so there is nothing to pre-roll, and a chain that
        /// is already consuming when the first buffer arrives is one fewer
        /// moving part in a measurement.
        ///
        /// The player node is asked for up front. A stack that has one can take
        /// a microphone; a stack that has none has to be rebuilt to get one, and
        /// the rebuild would take the recogniser with it — which is why the echo
        /// legs start the player before the microphone. Here the microphone
        /// stands for the whole pass and playback comes and goes inside it, so
        /// the node has to be there from the beginning.
        func start(label: String, locale requested: String?, sensitivity: String, report: Bool)
            async throws
        {
            if running { await stopRun() }

            eventLock.lock()
            events = []
            detectorEvents = 0
            levelEvents = 0
            detectorStreamEnded = false
            detectorError = nil
            finals = []
            volatileTail = ""
            nextRequest = 0
            eventLock.unlock()

            framesSeen = 0
            startError = nil
            detectorAttached = false
            analyzerFormatLine = ""
            self.label = label
            self.sensitivityName = sensitivity
            self.reportResults = report
            startedAt = CFAbsoluteTimeGetCurrent()
            startedAtEpochMs = Date().timeIntervalSince1970 * 1000

            NSLog(
                "RP-TURN start label=%@ sensitivity=%@ report=%d", label, sensitivity,
                report ? 1 : 0)

            guard SpeechTranscriber.isAvailable else {
                throw DictationError(
                    "This iPhone cannot transcribe on device. It needs iOS 26 on an iPhone 12 "
                        + "or later.")
            }
            try await Recogniser.ensureMicrophonePermission()

            let locale = try await Recogniser.resolveLocale(requested)
            localeTag = locale.identifier(.bcp47)
            let transcriber = Recogniser.makeTranscriber(locale: locale)
            self.transcriber = transcriber
            try await Recogniser.installModelIfNeeded(for: transcriber, locale: locale)

            // Asked of the transcriber alone, which is the call this repository
            // has run on a device. Whether a detector in the list would change
            // the answer is not a question this pass is for.
            let format = try await Recogniser.resolveAnalyzerFormat(for: transcriber)
            analyzerFormatLine = Recogniser.describe(format)

            let detector = SpeechDetector(
                detectionOptions: SpeechDetector.DetectionOptions(
                    sensitivityLevel: Self.level(sensitivity)),
                reportResults: report)
            self.detector = detector

            // The detector first, the transcriber second, the order Apple's own
            // note uses. It gates the transcriber, and the module list is the
            // only place that relationship is expressed.
            let analyzer = SpeechAnalyzer(modules: [detector, transcriber])
            self.analyzer = analyzer

            let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()

            do {
                try await analyzer.prepareToAnalyze(in: format)
            } catch {
                throw DictationError(
                    "The recognizer would not start: \(DictationError.describe(error))")
            }

            startConsumingResults(from: transcriber)
            startConsumingDetector(from: detector)

            do {
                try await analyzer.start(inputSequence: stream)
                detectorAttached = true
            } catch {
                // An analyzer that refuses a detector module is itself an answer
                // to question 1, so it is recorded as well as thrown: the
                // harness writes a report either way.
                let why = DictationError.describe(error)
                startError = why
                record("log", TurnPayload(error: "the analyzer refused the module list: \(why)"))
                throw DictationError("The recognizer would not start: \(why)")
            }

            observeSession()

            let opened = try AudioFront.shared.open(
                pressedAt: startedAt, timing: TimingLog(), needsPlayer: true
            ) { [weak self] buffer in
                self?.consume(buffer)
            }
            tapSampleRate = opened.format.sampleRate
            guard let made = AVAudioConverter(from: opened.format, to: format) else {
                throw DictationError(
                    "No audio converter from \(Recogniser.describe(opened.format)) to "
                        + "\(Recogniser.describe(format)).")
            }
            // Assigned together and behind the lock the tap reads through.
            // Buffers that arrive before this line find no converter and are
            // dropped, which costs the first fraction of a second of a pass
            // nobody is speaking into.
            feedLock.lock()
            converter = made
            analyzerFormat = format
            inputContinuation = continuation
            feedLock.unlock()

            running = true
            record("log", TurnPayload(line: "listening at \(Recogniser.describe(opened.format))"))
        }

        private static func level(_ name: String) -> SpeechDetector.SensitivityLevel {
            switch name {
            case "low": return .low
            case "high": return .high
            default: return .medium
            }
        }

        // MARK: - Stages

        /// A boundary in the pass. What separates "only the phone was speaking"
        /// from "only the person was" from "both at once" is nothing in the
        /// audio — it is the harness knowing which it just asked for, and this
        /// is where it says so.
        func stage(_ name: String) {
            NSLog("RP-TURN stage %@", name)
            record("stage", TurnPayload(stage: name))
        }

        /// Force the recogniser to settle now. Answers with how long the call
        /// itself took; what the words cost is the gap from here to the next
        /// `transcript` event carrying `isFinal`, which is in the same list.
        @discardableResult
        func finalizeNow() async -> Double {
            guard let analyzer = analyzer else { return -1 }
            eventLock.lock()
            nextRequest += 1
            let request = nextRequest
            let tail = volatileTail
            eventLock.unlock()

            record("finalize", TurnPayload(request: request, phase: "called", volatileAtCall: tail))
            let began = CFAbsoluteTimeGetCurrent()
            var failure: String?
            do {
                // nil finalizes through the last audio the analyzer has
                // consumed, which is not the last audio the tap has delivered: a
                // buffer in flight is not covered. The level frames around this
                // event are what say how much audio that is.
                try await analyzer.finalize(through: nil)
            } catch {
                failure = DictationError.describe(error)
            }
            let ms = (CFAbsoluteTimeGetCurrent() - began) * 1000
            NSLog("RP-TURN finalize %d returned in %.0fms", request, ms)
            record(
                "finalize",
                TurnPayload(request: request, phase: "returned", callMs: ms, error: failure))
            return ms
        }

        // MARK: - Stop

        /// Tears the pass down and answers with everything it saw.
        func stop() async -> TurnProbeReport {
            await stopRun()
            eventLock.lock()
            defer { eventLock.unlock() }
            let transcript = (finals + [volatileTail])
                .reduce("", Recogniser.joinSpeech)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return TurnProbeReport(
                label: label,
                ok: startError == nil,
                error: startError,
                locale: localeTag,
                sensitivity: sensitivityName,
                reportResults: reportResults,
                voiceProcessing: AudioFront.voiceProcessingOverride ?? true,
                tapSampleRate: tapSampleRate,
                analyzerFormat: analyzerFormatLine,
                detectorAttached: detectorAttached,
                detectorEvents: detectorEvents,
                detectorStreamEnded: detectorStreamEnded,
                detectorError: detectorError,
                levelEvents: levelEvents,
                transcript: transcript,
                startedAtEpochMs: startedAtEpochMs,
                events: events)
        }

        private func stopRun() async {
            for observer in observers { NotificationCenter.default.removeObserver(observer) }
            observers = []

            running = false
            // Never kept. A pass is a measurement and the next one has to build
            // its own stack, exactly as the echo legs do between theirs.
            AudioFront.shared.release(keep: false)

            feedLock.lock()
            let continuation = inputContinuation
            inputContinuation = nil
            converter = nil
            feedLock.unlock()
            continuation?.finish()

            if let analyzer = analyzer {
                let done = ProbeGate()
                Task {
                    try? await analyzer.finalizeAndFinishThroughEndOfInput()
                    done.signal()
                }
                await done.wait(upToMs: 3000) {
                    NSLog("RP-TURN finalizeAndFinish did not return in 3000ms")
                }
            }
            if resultsTask != nil {
                await resultsGate.wait(upToMs: 1000) { NSLog("RP-TURN results grace expired") }
            }
            resultsTask?.cancel()
            resultsTask = nil
            detectorTask?.cancel()
            detectorTask = nil
            analyzer = nil
            transcriber = nil
            detector = nil
        }

        // MARK: - Audio

        /// One record per buffer, unthrottled and unaggregated. The 15 Hz
        /// ceiling and the 0..1 window in DictationRun are what a meter needs; a
        /// threshold has to be fitted against what the microphone actually
        /// produced, and both of those destroy it.
        private func consume(_ buffer: AVAudioPCMBuffer) {
            let frames = Int(buffer.frameLength)
            let audioMs = tapSampleRate > 0 ? Double(framesSeen) / tapSampleRate * 1000 : 0
            framesSeen &+= UInt64(frames)

            var rms: Double? = nil
            if let channels = buffer.floatChannelData, frames > 0 {
                let samples = channels[0]
                var sum: Float = 0
                for index in 0..<frames { sum += samples[index] * samples[index] }
                let value = Double((sum / Float(frames)).squareRoot())
                if value.isFinite { rms = value }
            }
            eventLock.lock()
            levelEvents += 1
            eventLock.unlock()
            record("level", TurnPayload(inputRms: rms, frames: frames, audioMs: audioMs))

            feed(buffer)
        }

        /// The same conversion DictationRun does, repeated here rather than
        /// shared: hold-to-talk is shipping and a probe is not a reason to reach
        /// into it.
        private func feed(_ buffer: AVAudioPCMBuffer) {
            feedLock.lock()
            defer { feedLock.unlock() }
            guard
                let converter = converter,
                let format = analyzerFormat,
                let continuation = inputContinuation
            else { return }

            let ratio = format.sampleRate / buffer.format.sampleRate
            let capacity =
                AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 1024
            guard let converted = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity)
            else { return }

            var conversionError: NSError?
            var delivered = false
            let status = converter.convert(to: converted, error: &conversionError) { _, outStatus in
                if delivered {
                    outStatus.pointee = .noDataNow
                    return nil
                }
                delivered = true
                outStatus.pointee = .haveData
                return buffer
            }
            guard status != .error, converted.frameLength > 0 else { return }
            continuation.yield(AnalyzerInput(buffer: converted))
        }

        // MARK: - Results

        private func startConsumingResults(from transcriber: SpeechTranscriber) {
            resultsTask = Task { [weak self] in
                do {
                    for try await result in transcriber.results {
                        self?.handle(result)
                    }
                    self?.record("log", TurnPayload(line: "the transcript stream ended"))
                } catch {
                    self?.record(
                        "log",
                        TurnPayload(
                            error: "the transcript stream failed: "
                                + DictationError.describe(error)))
                }
                self?.resultsGate.signal()
            }
        }

        private func handle(_ result: SpeechTranscriber.Result) {
            let text = String(result.text.characters).trimmingCharacters(
                in: .whitespacesAndNewlines)
            eventLock.lock()
            if result.isFinal {
                if !text.isEmpty { finals.append(text) }
                volatileTail = ""
            } else {
                volatileTail = text
            }
            eventLock.unlock()

            // Shape and timing on the console, the words only in the file. The
            // plist promises the user their speech is never uploaded and a
            // sysdiagnose is an upload; the report goes nowhere but the app's
            // own container and the Mac that fetches it, which is the road the
            // echo legs' transcripts already travel.
            NSLog("RP-TURN %@ %d chars", result.isFinal ? "final" : "volatile", text.count)
            record(
                "transcript",
                TurnPayload(
                    isFinal: result.isFinal,
                    rangeStartMs: Self.ms(result.range.start),
                    rangeEndMs: Self.ms(result.range.end),
                    text: text))
        }

        /// The stream question 1 is about. A sequence that yields nothing and
        /// then ends is the "this road is closed" answer, and it looks exactly
        /// like a sequence that is still waiting — which is why the ending is
        /// recorded separately from the count.
        private func startConsumingDetector(from detector: SpeechDetector) {
            detectorTask = Task { [weak self] in
                do {
                    for try await result in detector.results {
                        self?.handleDetector(result)
                    }
                    self?.noteDetectorEnded(nil)
                } catch {
                    self?.noteDetectorEnded(DictationError.describe(error))
                }
            }
        }

        private func handleDetector(_ result: SpeechDetector.Result) {
            eventLock.lock()
            detectorEvents += 1
            eventLock.unlock()
            NSLog(
                "RP-TURN detector speech=%d final=%d", result.speechDetected ? 1 : 0,
                result.isFinal ? 1 : 0)
            record(
                "detector",
                TurnPayload(
                    speechDetected: result.speechDetected,
                    isFinal: result.isFinal,
                    rangeStartMs: Self.ms(result.range.start),
                    rangeEndMs: Self.ms(result.range.end),
                    finalizationMs: Self.ms(result.resultsFinalizationTime)))
        }

        private func noteDetectorEnded(_ failure: String?) {
            eventLock.lock()
            detectorStreamEnded = true
            if detectorError == nil { detectorError = failure }
            eventLock.unlock()
            NSLog("RP-TURN detector stream ended err=%@", failure ?? "none")
            record("log", TurnPayload(line: "the detector stream ended", error: failure))
        }

        // MARK: - What iOS takes back

        /// Log-only. A pass that went quiet because the session was interrupted
        /// and a pass that went quiet because the detector says nothing are the
        /// same silence in the numbers and must not be the same finding.
        private func observeSession() {
            let center = NotificationCenter.default
            let session = AVAudioSession.sharedInstance()
            observers.append(
                center.addObserver(
                    forName: AVAudioSession.interruptionNotification, object: session, queue: .main
                ) { [weak self] _ in
                    self?.record("log", TurnPayload(error: "the audio session was interrupted"))
                })
            observers.append(
                center.addObserver(
                    forName: AVAudioSession.routeChangeNotification, object: session, queue: .main
                ) { [weak self] _ in
                    let route = AVAudioSession.sharedInstance().currentRoute
                    let ins = route.inputs.map { $0.portType.rawValue }.joined(separator: ",")
                    let outs = route.outputs.map { $0.portType.rawValue }.joined(separator: ",")
                    self?.record("log", TurnPayload(line: "route in=[\(ins)] out=[\(outs)]"))
                })
        }

        // MARK: - Bookkeeping

        private func record(_ kind: String, _ payload: TurnPayload) {
            let at = (CFAbsoluteTimeGetCurrent() - startedAt) * 1000
            eventLock.lock()
            events.append(TurnEvent(sinceStartMs: at, kind: kind, payload: payload))
            eventLock.unlock()
        }

        /// Milliseconds, or nothing. An invalid or indefinite `CMTime` gives NaN
        /// through `CMTimeGetSeconds`, and `JSONEncoder` refuses to write NaN —
        /// one of them anywhere in the list would take the whole report down.
        private static func ms(_ time: CMTime) -> Double? {
            guard time.isValid, !time.isIndefinite else { return nil }
            let seconds = CMTimeGetSeconds(time)
            guard seconds.isFinite else { return nil }
            return seconds * 1000
        }

    #endif
}

// MARK: - The turn detector replay
//
// VoiceTurn.swift is a transliteration of src/info/companion/turn-detect.ts, and
// this is what makes "transliteration" a checkable claim rather than a promise:
// the harness sends the level sequences the earlier probe recorded on this
// phone, the device runs them through the ported machine, and
// src/smoke/turn-replay.ts compares the event stream against what the TypeScript
// machine answers over the same numbers.
//
// Arithmetic over a list. No microphone, no player, nobody in the room, one
// command. Debug builds only, like every other step under `turn-`.

/// One buffer as the harness sends it.
///
/// `db` is null for digital silence: JSON has no -Infinity, the machine's
/// contract takes one, and null is the only way to spell it on the wire. The
/// harness computes dB itself and sends the result, so `20 * log10` is never
/// evaluated twice in two languages and cannot disagree in its last bit.
struct TurnReplayFrame: Decodable {
    let atMs: Double
    let db: Double?
}

/// The config patch, every key optional. An absent key is that field's default,
/// which is what `resolveTurnDetectConfig` does with a partial over there.
struct TurnReplayConfig: Decodable {
    let startDb: Double?
    let startFrames: Int?
    let confirmMs: Double?
    let resumeMs: Double?
    let hangoverMs: Double?
    let resumeGuardMs: Double?

    func resolved() -> TurnDetectConfig {
        let base = TurnDetectConfig()
        return TurnDetectConfig(
            startDb: startDb ?? base.startDb,
            startFrames: startFrames ?? base.startFrames,
            confirmMs: confirmMs ?? base.confirmMs,
            resumeMs: resumeMs ?? base.resumeMs,
            hangoverMs: hangoverMs ?? base.hangoverMs,
            resumeGuardMs: resumeGuardMs ?? base.resumeGuardMs)
    }
}

/// One event the ported machine announced, and the buffer it announced it on.
/// Flat, and the same shape the TypeScript side compares against: `silentMs` is
/// written for `end` and left out of the other three.
struct TurnReplayEvent: Encodable {
    let atMs: Double
    let type: String
    let silentMs: Double?

    enum CodingKeys: String, CodingKey {
        case atMs, type, silentMs
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(atMs, forKey: .atMs)
        try c.encode(type, forKey: .type)
        try c.encodeIfPresent(silentMs, forKey: .silentMs)
    }
}

/// What one replay produced.
struct TurnReplayReport: Encodable {
    /// The case's name, carried in and back out on `label`.
    let label: String
    let frames: Int
    /// The config the machine actually ran with, after `TurnDetectConfig`'s
    /// initialiser clamped it. Compared against `resolveTurnDetectConfig`'s
    /// answer, so a clamp that drifted is caught by the same run.
    let startDb: Double
    let startFrames: Int
    let confirmMs: Double
    let resumeMs: Double
    let hangoverMs: Double
    let resumeGuardMs: Double
    let events: [TurnReplayEvent]
}

enum TurnReplay {
    #if DEBUG

        static func run(
            label: String, frames: [TurnReplayFrame], config: TurnReplayConfig?
        ) -> TurnReplayReport {
            let resolved = config?.resolved() ?? TurnDetectConfig()
            var machine = VoiceTurn(config: resolved)
            var events: [TurnReplayEvent] = []
            for frame in frames {
                // A null level is digital silence, which is what the machine
                // reads -Infinity as.
                guard let event = machine.step(db: frame.db ?? -.infinity, atMs: frame.atMs)
                else { continue }
                switch event {
                case .duck:
                    events.append(TurnReplayEvent(atMs: frame.atMs, type: "duck", silentMs: nil))
                case .stop:
                    events.append(TurnReplayEvent(atMs: frame.atMs, type: "stop", silentMs: nil))
                case .resume:
                    events.append(
                        TurnReplayEvent(atMs: frame.atMs, type: "resume", silentMs: nil))
                case .end(let silentMs):
                    events.append(
                        TurnReplayEvent(atMs: frame.atMs, type: "end", silentMs: silentMs))
                }
            }
            return TurnReplayReport(
                label: label,
                frames: frames.count,
                startDb: resolved.startDb,
                startFrames: resolved.startFrames,
                confirmMs: resolved.confirmMs,
                resumeMs: resolved.resumeMs,
                hangoverMs: resolved.hangoverMs,
                resumeGuardMs: resolved.resumeGuardMs,
                events: events)
        }

    #endif
}
