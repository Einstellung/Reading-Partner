// The full-duplex call (docs/33 M-voice-3, docs/45): the microphone stays open
// while the companion speaks, and who is talking is decided here, on the phone,
// without a frame or a verdict ever waiting on the webview. This file is the
// native half of the contract in src/info/companion/conversation.ts; that file's
// event kinds and payload fields are the specification, and voice-session.ts is
// the consumer that says in which order they have to arrive.
//
// It is not DictationRun with the backstop taken off. A hold is single-use,
// pre-rolls the first 300 ms, gates its emission per press and hands back one
// transcript at the end; a call has no press, no end the user asks for turn by
// turn, and its output is a stream of turns. What the two share is exactly what
// Recogniser.swift and AudioFront.swift already hold — locale, model, format,
// permission, the engine — and nothing else is reached for.
//
// Threads, because the audio thread is the whole difficulty:
//
//   tap (audio thread)     RMS and dB of the buffer, no allocation; convert and
//                          yield to the analyzer (the same conversion every run
//                          here does); one `stepTurn` into SpeechOut, which is a
//                          dispatch and nothing else; a level event at 10 Hz.
//   SpeechOut.queue        owns the VoiceTurn and the player. The step, the
//                          verdict and the act on the player (duck, cut, resume)
//                          happen there in one queue turn, and the cut position
//                          is read on that same turn. `verdict(_:)` below runs
//                          there too, so it never calls SpeechOut synchronously.
//   results task           the recogniser's stream; segments and their audio
//                          ranges go into `finals`/`tail` under `stateLock`.
//   a Task per turn end    `finalize(through: nil)` on the analyzer (50 ms,
//                          measured 2026-09-05, no words lost), then the turn is
//                          settled and `speech-end` sent.
//   main                   the session notifications, and every emission —
//                          Tauri's listener table is read on one queue.
//   the plugin's chain     start and stop.
//
// `stateLock` is the one lock the turn bookkeeping uses and it is never held
// across an await or an emission's own work; `feedLock` guards the converter the
// tap reads, the way the turn probe's does.

import AVFoundation
import Foundation
import Speech
import UIKit

/// The `conversation` event's payload. One struct for every kind, with the
/// fields a kind does not carry left nil and so absent on the wire — the
/// webview reads the fields its kind promises and checks each one before it
/// reads it (conversation.ts, "what a payload has to carry").
struct ConversationEvent: Encodable {
    let kind: String
    /// The user turn this belongs to, from 1; 0 before any turn was taken.
    let turn: Int
    var text: String? = nil
    var silentMs: Double? = nil
    var value: Double? = nil
    var running: Bool? = nil
    var reason: String? = nil
    var utterance: UInt64? = nil
    var cut: SpeechCut? = nil
    var range: SpeechRange? = nil
}

/// Where a barge-in cut the companion off, as `SpeechPosition` spells it for
/// the webview: `sentence` where the player says `index`.
struct SpeechCut: Encodable {
    let utterance: UInt64
    let sentence: Int
    let charOffset: Int
    let playedMs: Double
}

/// The span of the call's audio timeline a recogniser result covers.
struct SpeechRange: Encodable {
    let startMs: Double
    let endMs: Double
}

final class ConversationRun {
    typealias Emit = (ConversationEvent) -> Void

    /// A recogniser result and where in the audio it sits. The range is the
    /// analyzer's `.audioTimeRange`, in the same time base as the stamps the tap
    /// puts on the verdicts (frames fed to the analyzer over its sample rate),
    /// which is what lets a result be matched to a turn.
    private struct Segment {
        let text: String
        let startMs: Double?
        let endMs: Double?

        /// Whether any of this result falls inside the turn. A result with no
        /// range is taken to belong to whatever turn is asking. The slack covers
        /// the onset the recogniser hears before the first buffer crosses the
        /// threshold.
        func overlaps(_ window: TurnWindow) -> Bool {
            guard let start = startMs, let end = endMs else { return true }
            let slack = ConversationRun.windowSlackMs
            let windowEnd = window.endMs ?? Double.infinity
            return end > window.startMs - slack && start < windowEnd + slack
        }
    }

    /// One user turn's stretch of the audio timeline: from the duck that opened
    /// it to the buffer on which the hangover expired.
    private struct TurnWindow {
        let number: Int
        let startMs: Double
        var endMs: Double?
        var silentMs: Double = 0
    }

    private static let windowSlackMs: Double = 300
    /// The same window DictationRun's meter uses: a human voice through the
    /// voice-processing unit's gain.
    private static let quietDb: Double = -50
    private static let loudDb: Double = -10
    private static let levelInterval: CFAbsoluteTime = 0.1
    /// How long a forced finalize may take before the turn is settled with what
    /// the recogniser had. Measured at 50 ms; this is the ceiling, not a target.
    private static let finalizeGraceMs: UInt64 = 1500
    private static let finishGraceMs: UInt64 = 3000
    private static let resultsGraceMs: UInt64 = 1000

    private let emit: Emit

    // MARK: The recogniser half

    private var transcriber: SpeechTranscriber?
    private var analyzer: SpeechAnalyzer?
    private var resultsTask: Task<Void, Never>?
    private let resultsGate = Gate()

    /// What the tap reads. Assigned together once the microphone is open, and
    /// cleared together on the way out.
    private let feedLock = NSLock()
    private var converter: AVAudioConverter?
    private var analyzerFormat: AVAudioFormat?
    private var inputContinuation: AsyncStream<AnalyzerInput>.Continuation?
    private var tapSampleRate: Double = 0

    // Audio thread only.
    private var framesFed: UInt64 = 0
    private var lastLevelAt: CFAbsoluteTime = 0
    private var loggedConversionFailure = false

    // MARK: Turns

    private let stateLock = NSLock()
    /// The last turn taken. Bumped on `stop`, the moment the user has the floor.
    private var turn = 0
    /// The user turn on the floor, or waiting on its finalize.
    private var open: TurnWindow?
    /// The last turn settled, which a late final can still belong to.
    private var closed: TurnWindow?
    /// Settled stretches nobody has claimed yet.
    private var finals: [Segment] = []
    /// The hypothesis beyond the last final.
    private var tail: Segment?
    /// Where the most recent duck fell on the audio timeline. A turn's window
    /// opens there, not at the stop that confirms it 300 ms later.
    private var lastDuckMs: Double = 0

    // MARK: Lifecycle

    private let emitLock = NSLock()
    private var emitting = false

    private let stopLock = NSLock()
    private var stopping = false
    private var opened = false
    private var observers: [NSObjectProtocol] = []

    init(emit: @escaping Emit) {
        self.emit = emit
    }

    /// Whether this run still has the microphone. False once anything —
    /// `stop_conversation`, an interruption, the app leaving the screen — has
    /// begun tearing it down.
    var isLive: Bool {
        stopLock.lock()
        defer { stopLock.unlock() }
        return opened && !stopping
    }

    // MARK: - Start

    /// Brings the recogniser up first and opens the microphone last, the turn
    /// probe's order: a call has no press to lose the head of, and a buffer that
    /// arrives before the converter is there is dropped rather than held.
    func start(locale requested: String?, contextualStrings: [String]) async throws {
        NSLog(
            "RP-CALL start locale=%@ contextualStrings=%d", requested ?? "auto",
            contextualStrings.count)
        guard SpeechTranscriber.isAvailable else {
            throw DictationError(
                "This iPhone cannot transcribe on device. It needs iOS 26 on an iPhone 12 or later.")
        }
        try await Recogniser.ensureMicrophonePermission()

        let locale = try await Recogniser.resolveLocale(requested)
        let transcriber = Recogniser.makeTranscriber(locale: locale)
        self.transcriber = transcriber
        try await Recogniser.installModelIfNeeded(for: transcriber, locale: locale)
        let format = try await Recogniser.resolveAnalyzerFormat(for: transcriber)

        let analyzer = SpeechAnalyzer(modules: [transcriber])
        self.analyzer = analyzer
        let hints = Recogniser.capContextualStrings(contextualStrings)
        if !hints.isEmpty {
            let context = AnalysisContext()
            context.contextualStrings = [.general: hints]
            try await analyzer.setContext(context)
        }
        do {
            try await analyzer.prepareToAnalyze(in: format)
        } catch {
            throw DictationError("The recognizer would not start: \(DictationError.describe(error))")
        }

        let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
        startConsumingResults(from: transcriber)
        do {
            try await analyzer.start(inputSequence: stream)
        } catch {
            throw DictationError("The recognizer would not start: \(DictationError.describe(error))")
        }

        observe()
        let front = try AudioFront.shared.open(
            pressedAt: CFAbsoluteTimeGetCurrent(), timing: TimingLog(), needsPlayer: true
        ) { [weak self] buffer in
            self?.consume(buffer)
        }
        stopLock.lock()
        opened = true
        stopLock.unlock()
        guard let made = AVAudioConverter(from: front.format, to: format) else {
            throw DictationError(
                "No audio converter from \(Recogniser.describe(front.format)) to "
                    + "\(Recogniser.describe(format)).")
        }
        feedLock.lock()
        converter = made
        analyzerFormat = format
        inputContinuation = continuation
        tapSampleRate = front.format.sampleRate
        feedLock.unlock()

        // Last: from here the tap's numbers reach a machine that can stop the
        // player. Defaults throughout; the immunity window is live from the
        // next `speak_begin`.
        SpeechOut.shared.setConversation(
            VoiceTurn(),
            verdict: { [weak self] verdict in self?.verdict(verdict) },
            spoken: { [weak self] utterance, reason in
                self?.spoken(utterance: utterance, reason: reason)
            })
        NSLog("RP-CALL listening at %@", Recogniser.describe(front.format))
    }

    /// Opens the gate and says the call is up. Called by the plugin after the
    /// start's response has gone out, for the reason DictationRun's is.
    func beginEmitting() {
        emitLock.lock()
        emitting = true
        emitLock.unlock()
        send(ConversationEvent(kind: "state", turn: currentTurn(), running: true, reason: "opened"))
    }

    // MARK: - Stop

    /// Tears the call down and says so. `reason` is a ConversationReason from
    /// conversation.ts: `closed` for the user's own stop, `released` when the
    /// microphone was wanted for something else, `interrupted` and `lost` for
    /// what iOS took, `failed` for a start that did not complete.
    ///
    /// The player is not stopped: it outlives the call (docs/33), and what is
    /// taken away is the detector, which puts the volume back if it was down.
    /// Safe to call twice and on a run whose start threw.
    func stop(reason: String) async {
        guard claimStop() else { return }
        NSLog("RP-CALL stop reason=%@", reason)
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
        observers = []

        SpeechOut.shared.setConversation(nil, verdict: nil, spoken: nil)

        let wasOpened: Bool
        stopLock.lock()
        wasOpened = opened
        stopLock.unlock()
        if wasOpened {
            // Kept for the next call or the next hold when it was this side that
            // ended it; a session iOS broke is not worth keeping, and AudioFront
            // would refuse anyway.
            AudioFront.shared.release(keep: reason == "closed" || reason == "released")
        }

        feedLock.lock()
        let continuation = inputContinuation
        inputContinuation = nil
        converter = nil
        feedLock.unlock()
        continuation?.finish()

        if let analyzer = analyzer {
            let finished = Gate()
            Task {
                try? await analyzer.finalizeAndFinishThroughEndOfInput()
                finished.signal()
            }
            await finished.wait(upToMs: Self.finishGraceMs) {
                NSLog("RP-CALL finalizeAndFinish did not return in %llums", Self.finishGraceMs)
            }
        }
        if resultsTask != nil {
            await resultsGate.wait(upToMs: Self.resultsGraceMs) {
                NSLog("RP-CALL results grace expired")
            }
        }
        resultsTask?.cancel()
        resultsTask = nil

        // A turn still on the floor goes down with the call. Nothing settles
        // it: the webview cuts what was in flight on the state event.
        stateLock.lock()
        open = nil
        tail = nil
        finals = []
        stateLock.unlock()

        // Through the gate whatever its state — the one event the webview must
        // hear after a start it was told succeeded — and then the gate shuts
        // for good.
        if wasOpened {
            emit(ConversationEvent(kind: "state", turn: currentTurn(), running: false, reason: reason))
        }
        emitLock.lock()
        emitting = false
        emitLock.unlock()
    }

    private func claimStop() -> Bool {
        stopLock.lock()
        defer { stopLock.unlock() }
        if stopping { return false }
        stopping = true
        return true
    }

    // MARK: - What iOS takes back

    /// The three ways the microphone stops being ours (docs/pitfall/162), each
    /// the end of the call. v1 is foreground-only (docs/33, 2026-09-05): the app
    /// leaving the screen ends the call rather than continuing it, and the
    /// webview hears `state { running: false }` rather than silence.
    private func observe() {
        let center = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()

        observers.append(
            center.addObserver(
                forName: AVAudioSession.interruptionNotification, object: session, queue: .main
            ) { [weak self] note in
                guard
                    let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                    let type = AVAudioSession.InterruptionType(rawValue: raw),
                    type == .began
                else { return }
                NSLog("RP-CALL interrupted")
                Task { [weak self] in await self?.stop(reason: "interrupted") }
            })

        observers.append(
            center.addObserver(
                forName: AVAudioSession.routeChangeNotification, object: session, queue: .main
            ) { [weak self] _ in
                guard let self = self, self.isLive,
                    AVAudioSession.sharedInstance().currentRoute.inputs.isEmpty
                else { return }
                NSLog("RP-CALL the microphone went away")
                Task { [weak self] in await self?.stop(reason: "lost") }
            })

        observers.append(
            center.addObserver(
                forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
            ) { [weak self] _ in
                NSLog("RP-CALL the app left the screen")
                Task { [weak self] in await self?.stop(reason: "lost") }
            })
    }

    // MARK: - The audio thread

    /// One microphone buffer. The level for the detector is the buffer's own
    /// RMS in dBFS, `-inf` for digital silence, the way the turn probe measured
    /// it and the way turn-detect.ts's fixtures were recorded.
    private func consume(_ buffer: AVAudioPCMBuffer) {
        let frames = Int(buffer.frameLength)
        guard frames > 0, let channels = buffer.floatChannelData else { return }
        let samples = channels[0]
        var sum: Float = 0
        for index in 0..<frames {
            let value = samples[index]
            sum += value * value
        }
        let rms = Double((sum / Float(frames)).squareRoot())
        let db = rms > 0 ? 20 * log10(rms) : -Double.infinity
        let now = CFAbsoluteTimeGetCurrent()

        feed(buffer)
        // The end of this buffer on the analyzer's timeline, which is what a
        // result's range is measured on.
        let audioMs = tapSampleRate > 0 ? Double(framesFed) / tapSampleRate * 1000 : 0
        SpeechOut.shared.stepTurn(db: db, atMs: now * 1000, audioMs: audioMs)

        guard now - lastLevelAt >= Self.levelInterval else { return }
        lastLevelAt = now
        let scaled = (db - Self.quietDb) / (Self.loudDb - Self.quietDb)
        let value = min(max(scaled.isFinite ? scaled : 0, 0), 1)
        send(ConversationEvent(kind: "level", turn: currentTurn(), value: value))
    }

    /// The conversion every run here does, into the format the analyzer named.
    /// Counts the frames it fed, so `audioMs` above and the results' ranges are
    /// on one clock.
    private func feed(_ buffer: AVAudioPCMBuffer) {
        feedLock.lock()
        defer { feedLock.unlock() }
        guard
            let converter = converter,
            let format = analyzerFormat,
            let continuation = inputContinuation
        else { return }

        let ratio = format.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 1024
        guard let converted = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
            return
        }

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
        if status == .error {
            if !loggedConversionFailure {
                loggedConversionFailure = true
                let detail = conversionError.map { DictationError.describe($0) } ?? "no detail"
                NSLog("RP-CALL audio conversion failed: %@", detail)
            }
            return
        }
        guard converted.frameLength > 0 else { return }
        framesFed &+= UInt64(buffer.frameLength)
        continuation.yield(AnalyzerInput(buffer: converted))
    }

    // MARK: - Verdicts (on SpeechOut's queue)

    /// The detector spoke and the player has already done its part. What is
    /// left is the bookkeeping and the event; nothing here touches SpeechOut.
    private func verdict(_ verdict: TurnVerdict) {
        switch verdict.event {
        case .duck:
            stateLock.lock()
            lastDuckMs = verdict.audioMs
            let number = turn
            stateLock.unlock()
            send(ConversationEvent(kind: "speech-duck", turn: number))

        case .resume:
            send(ConversationEvent(kind: "speech-resume", turn: currentTurn()))

        case .stop:
            stateLock.lock()
            // The previous turn still waiting on its finalize is settled with
            // what it has: the user has started the next one, and a turn
            // cannot arrive after the one that followed it.
            if let previous = open {
                settleLocked(previous)
            }
            turn += 1
            open = TurnWindow(number: turn, startMs: lastDuckMs, endMs: nil)
            let number = turn
            stateLock.unlock()
            var event = ConversationEvent(kind: "speech-stop", turn: number)
            if let cut = verdict.cut, cut.index >= 0 {
                event.cut = SpeechCut(
                    utterance: cut.utterance, sentence: cut.index, charOffset: cut.charOffset,
                    playedMs: cut.playedMs)
            }
            send(event)

        case .end(let silentMs):
            stateLock.lock()
            guard var window = open else {
                stateLock.unlock()
                return
            }
            window.endMs = verdict.audioMs
            window.silentMs = silentMs
            open = window
            stateLock.unlock()
            let number = window.number
            Task { [weak self] in
                guard let self = self else { return }
                await self.forceFinal()
                self.stateLock.lock()
                if let current = self.open, current.number == number {
                    self.settleLocked(current)
                }
                self.stateLock.unlock()
            }
        }
    }

    /// The end of a turn's playback, from the player.
    private func spoken(utterance: UInt64, reason: String) {
        send(ConversationEvent(
            kind: "spoken", turn: currentTurn(), reason: reason, utterance: utterance))
    }

    /// Settle now rather than in 2.6 s. Bounded, because a turn whose end never
    /// arrives holds the floor for the rest of the call.
    private func forceFinal() async {
        guard let analyzer = analyzer else { return }
        let began = CFAbsoluteTimeGetCurrent()
        let done = Gate()
        Task {
            do {
                try await analyzer.finalize(through: nil)
            } catch {
                NSLog("RP-CALL finalize failed: %@", DictationError.describe(error))
            }
            done.signal()
        }
        await done.wait(upToMs: Self.finalizeGraceMs) {
            NSLog("RP-CALL finalize did not return in %llums", Self.finalizeGraceMs)
        }
        NSLog("RP-CALL finalize %.0fms", (CFAbsoluteTimeGetCurrent() - began) * 1000)
    }

    /// The turn is over: everything the recogniser settled inside its window,
    /// plus whatever hypothesis is still standing, joined the way the webview
    /// joins, goes out as `speech-end`. An empty string is still a turn — the
    /// webview keeps the slot so a final that settles later has somewhere to
    /// land. Called with `stateLock` held.
    private func settleLocked(_ window: TurnWindow) {
        var parts: [String] = []
        finals = finals.filter { segment in
            if segment.overlaps(window) {
                parts.append(segment.text)
                return false
            }
            // Older than this turn and claimed by nobody: the playback leaking
            // back up the microphone, or the room. Not the user's words.
            if let end = segment.endMs, end < window.startMs - Self.windowSlackMs {
                NSLog("RP-CALL dropped a final of %d chars outside any turn", segment.text.count)
                return false
            }
            return true
        }
        if let hypothesis = tail, hypothesis.overlaps(window) {
            parts.append(hypothesis.text)
            tail = nil
        }
        let text = parts.reduce("", Recogniser.joinSpeech)
        closed = window
        open = nil
        NSLog("RP-CALL turn %d ended: %d chars, silent %.0fms", window.number, text.count, window.silentMs)
        send(ConversationEvent(kind: "speech-end", turn: window.number, text: text, silentMs: window.silentMs))
    }

    // MARK: - Results

    private func startConsumingResults(from transcriber: SpeechTranscriber) {
        resultsTask = Task { [weak self] in
            do {
                for try await result in transcriber.results {
                    self?.handle(result)
                }
            } catch {
                NSLog("RP-CALL the results stream failed: %@", DictationError.describe(error))
            }
            self?.resultsGate.signal()
        }
    }

    /// Shape and timing on the console, never the words (the plist's promise;
    /// see DictationRun.handle). A final goes to the turn whose window it falls
    /// in: the one on the floor, to be sent with it; the one just settled, as a
    /// late `final` of its own; and one that falls in neither is not the user's
    /// and goes nowhere.
    private func handle(_ result: SpeechTranscriber.Result) {
        let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
        let segment = Segment(
            text: text, startMs: Self.ms(result.range.start), endMs: Self.ms(result.range.end))
        NSLog("RP-CALL %@ %d chars", result.isFinal ? "final" : "volatile", text.count)

        stateLock.lock()
        defer { stateLock.unlock() }
        if !result.isFinal {
            tail = text.isEmpty ? nil : segment
            return
        }
        tail = nil
        guard !text.isEmpty else { return }
        if let current = open, segment.overlaps(current) {
            finals.append(segment)
            return
        }
        if let last = closed, segment.overlaps(last) {
            var event = ConversationEvent(kind: "final", turn: last.number, text: text)
            if let start = segment.startMs, let end = segment.endMs {
                event.range = SpeechRange(startMs: start, endMs: end)
            }
            send(event)
            return
        }
        NSLog("RP-CALL dropped a final of %d chars outside any turn", text.count)
    }

    private static func ms(_ time: CMTime) -> Double? {
        guard time.isValid, !time.isIndefinite else { return nil }
        let seconds = CMTimeGetSeconds(time)
        guard seconds.isFinite else { return nil }
        return seconds * 1000
    }

    // MARK: - Emission

    private func currentTurn() -> Int {
        stateLock.lock()
        defer { stateLock.unlock() }
        return turn
    }

    private func send(_ event: ConversationEvent) {
        emitLock.lock()
        let open = emitting
        emitLock.unlock()
        guard open else { return }
        emit(event)
    }
}
