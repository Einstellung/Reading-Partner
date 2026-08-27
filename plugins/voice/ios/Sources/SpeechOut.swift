// The mouth. One AVAudioPlayerNode on the engine AudioFront already keeps for
// the microphone, fed one sentence at a time, with a book of what was queued so
// that an interruption can say which sentence and which character it landed on.
//
// Three rules the rest of the file exists to keep, all of them learned from
// AVAudioPlayerNode's own header and from what the queue's timeline does when
// nobody is looking:
//
// 1. A drained queue is a `stop()`. `scheduleBuffer` with no `when` splices
//    buffers end to end, so a running frame total is exactly the position in the
//    speech — but only while something is playing. The player's timeline keeps
//    advancing through the trailing silence after the last sentence and through
//    a gap where the next sentence has not arrived, and both would be counted as
//    speech. Stopping on drain and starting the count again on the next
//    `play()` is the only thing that keeps the book honest. It covers the turn
//    ending (the `last` sentence has been played) and the turn starving (it has
//    not) with the same mechanism; only the record afterwards tells them apart.
//
// 2. Nothing touches the player while the engine is not running.
//    `-[AVAudioPlayerNode play]` asserts `required condition is false:
//    _engine->IsRunning()`, which is an Objective-C exception that Swift `try`
//    does not catch and that kills the process.
//
// 3. An interruption is `stop()`, never `reset()`. `reset()` promises nothing
//    about buffers already scheduled.
//
// Completion handlers arrive on an audio-adjacent thread, and Apple's header
// says calling back into the player from inside one can deadlock. Every handler
// here does one thing: post a message to this file's serial queue.

import AVFoundation
import Foundation

/// What `enqueue_speech` answers with. Rust reads `dropped` to know the turn it
/// belongs to has already been stopped, and the rest is measurement.
struct SpeechAck: Encodable {
    /// True when this sentence was thrown away rather than queued: its turn was
    /// stopped between the vendor sending it and it arriving here.
    let dropped: Bool
    let leadMs: Double
    let trailMs: Double
    /// How much speech is queued ahead of the listener, this sentence included.
    let queuedMs: Double
    /// Where this sentence starts on the current player timeline.
    let startMs: Double
}

/// Where the voice is. Answered by `stop_speaking` and by `position`.
struct SpeechPosition: Encodable {
    let speaking: Bool
    let utterance: UInt64
    let index: Int
    /// Characters into that sentence, linearly interpolated (SpeechClock).
    let charOffset: Int
    let playedMs: Double
}

/// One sentence's row in the measurement record. Written on the completion
/// handler, read by the bench.
struct SpeechSentenceRow: Encodable {
    let index: Int
    let chars: Int
    let bytes: Int
    let frames: Int
    let leadMs: Double
    let trailMs: Double
    let startFrame: Int
    /// Player frames at the moment this sentence's audio had left the node,
    /// against the frame the book says it ends on. The difference is the whole
    /// output latency, and it is the number E2 is about.
    let completionFrame: Int
    let latencyMs: Double
    let enqueuedAtMs: Double
    let completedAtMs: Double
}

/// Everything one run of the bench measured. Not a shipping surface.
struct SpeechReport: Encodable {
    let label: String
    let sentences: [SpeechSentenceRow]
    /// Every level sample this run produced, in dBFS before the mapping. The
    /// mapped values went to the webview as events; these are what a window is
    /// refitted against.
    let levelDb: [Double]
    let levelIntervalMs: [Double]
    /// Frames in the first tap buffer. `bufferSize` is a request, not a contract
    /// (docs/pitfall/161).
    let firstTapFrames: Int
    let tapBuffers: Int
    let underruns: Int
    let stops: [String]
    let outputPresentationLatencyMs: Double
    let sessionOutputLatencyMs: Double
    let ioBufferDurationMs: Double
    let outputVolume: Double
    let sessionSampleRate: Double
    let outputRoute: String
    let playbackFormat: String
    let capturedFrames: Int
    let capturePath: String?
}

final class SpeechOut {
    static let shared = SpeechOut()

    /// 24 kHz mono float32, deinterleaved: what Core Audio calls its standard
    /// format and what every vendor in docs/46 returns. A sentence that arrives
    /// at any other rate is refused rather than resampled — a resampler here
    /// would hide a vendor change that the account in SpeechClock depends on.
    static let sampleRate: Double = 24000
    static let playbackFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32, sampleRate: SpeechOut.sampleRate, channels: 1,
        interleaved: false)!
    private var playbackFormat: AVAudioFormat { SpeechOut.playbackFormat }

    /// Every call that touches the player is on this queue, including the ones
    /// that arrive as completion handlers.
    private let queue = DispatchQueue(label: "com.readingpartner.voice.speech")

    private var player: AVAudioPlayerNode?
    private var speaking = false
    private var utterance: UInt64 = 0
    /// Bumped before every `stop()`. `stop()` calls the completion handler of
    /// every buffer it discards, and the handler cannot tell "played" from
    /// "thrown away" on its own; a handler whose generation is stale is one of
    /// the thrown-away ones.
    private var generation: UInt64 = 0
    private var pending = 0
    private var sawLast = false
    private var clock = SpeechClock()
    private var startedAt: CFAbsoluteTime = 0

    // Measurement, bench only. Cleared on every `play()`.
    private var label = ""
    private var rows: [SpeechSentenceRow] = []
    private var levelDb: [Double] = []
    private var levelAt: [Double] = []
    private var lastLevelAt: CFAbsoluteTime = 0
    private var firstTapFrames = 0
    private var tapBuffers = 0
    private var underruns = 0
    private var stops: [String] = []

    /// Where events leave for the webview. Injected by VoicePlugin so this file
    /// knows nothing about Tauri.
    private var emitter: ((String, Double, String?) -> Void)?

    // MARK: - Level

    /// Linear RMS mapped to 0..1 across this window, for the orb.
    ///
    /// Measured on the twelve-sentence mimo fixture, 745 windows of 100 ms:
    /// p10 -32.6, p50 -18.9, p90 -14.4 and a loudest window of -10.4 dBFS, with
    /// the pauses inside a sentence falling to -35..-50. Through this window
    /// that is p10 0.24, p50 0.68, p90 0.82 and a peak of 0.93.
    ///
    /// Not the -50/-10 of DictationRun: that window is fitted to a human voice
    /// arriving through the voice-processing unit's automatic gain, which is
    /// worth 18 dB on near speech. This is a file whose level the vendor set.
    private static let quietDb: Double = -40
    private static let loudDb: Double = -9
    /// 2400 frames at 24 kHz is 100 ms, the smallest the header allows, and the
    /// same 10 Hz the dictation meter already runs at.
    private static let tapFrames: AVAudioFrameCount = 2400

    // MARK: - Capture

    #if DEBUG
        /// A bench run's own copy of what the player put out, so that the twelve
        /// sentences can be compared with their sources sample by sample on a
        /// machine rather than by ear. Preallocated: the tap runs on the audio
        /// thread and an allocation there would show up in the very seam it is
        /// there to measure.
        private var capture: UnsafeMutablePointer<Int16>?
        private var captureCapacity = 0
        private var captureCount = 0
        private var capturePath: String?
    #endif

    private init() {}

    func setEmitter(_ emitter: @escaping (String, Double, String?) -> Void) {
        queue.async { self.emitter = emitter }
    }

    // MARK: - The queue

    /// Puts one sentence on the back of the queue and starts the player if it is
    /// not already going.
    ///
    /// Synchronous on the caller's thread, run on the serial queue: the answer
    /// carries the trim and the queue depth, and Rust wants both before it
    /// decides whether to keep synthesising ahead.
    func enqueue(
        pcm: Data, sampleRate: Double, chars: Int, utterance: UInt64, index: Int, last: Bool,
        trim: Bool
    ) throws -> SpeechAck {
        try queue.sync {
            guard sampleRate == SpeechOut.sampleRate else {
                throw DictationError(
                    "This voice speaks at \(Int(sampleRate)) Hz and the player is wired for "
                        + "\(Int(SpeechOut.sampleRate)) Hz.")
            }
            // A sentence from a turn that has already been stopped. Answering
            // rather than throwing: the vendor was mid-sentence when the user
            // interrupted, and that is not an error on anybody's part.
            if speaking && utterance != self.utterance {
                return SpeechAck(
                    dropped: true, leadMs: 0, trailMs: 0, queuedMs: 0, startMs: 0)
            }
            if !speaking && utterance < self.utterance {
                return SpeechAck(
                    dropped: true, leadMs: 0, trailMs: 0, queuedMs: 0, startMs: 0)
            }

            let node = try attachedPlayer()
            let bytes = pcm.count
            let total = bytes / 2
            guard total > 0 else {
                throw DictationError("That sentence arrived with no audio in it.")
            }

            var bounds = 0..<total
            if trim {
                bounds = pcm.withUnsafeBytes { raw -> Range<Int> in
                    guard let base = raw.baseAddress else { return 0..<total }
                    // The bytes are little-endian 16-bit, which is this
                    // architecture's own order, so the pointer is a view rather
                    // than a copy.
                    return speechBounds(
                        base.assumingMemoryBound(to: Int16.self), count: total,
                        sampleRate: sampleRate)
                }
            }
            let frames = bounds.count
            guard frames > 0 else {
                throw DictationError("That sentence trimmed away to nothing.")
            }

            guard
                let buffer = AVAudioPCMBuffer(
                    pcmFormat: playbackFormat, frameCapacity: AVAudioFrameCount(frames)),
                let channel = buffer.floatChannelData?[0]
            else {
                throw DictationError("The player could not take that sentence.")
            }
            buffer.frameLength = AVAudioFrameCount(frames)
            pcm.withUnsafeBytes { raw in
                guard let base = raw.baseAddress else { return }
                let samples = base.assumingMemoryBound(to: Int16.self)
                for i in 0..<frames {
                    channel[i] = Float(samples[bounds.lowerBound + i]) / 32768.0
                }
            }

            if !speaking {
                guard let engine = try AudioFront.shared.speakerEngine() else {
                    throw DictationError("The player has no engine to speak through.")
                }
                guard engine.isRunning else {
                    throw DictationError(
                        "The audio engine is not running, so the player was not started.")
                }
                beginLocked(utterance: utterance)
                node.play()
            }

            let startFrame = clock.append(index: index, chars: chars, frames: frames)
            pending += 1
            if last { sawLast = true }
            let scheduledGeneration = generation
            let enqueuedAt = (CFAbsoluteTimeGetCurrent() - startedAt) * 1000
            let chars_ = chars
            let bytes_ = bytes
            let leadMs = Double(bounds.lowerBound) / sampleRate * 1000
            let trailMs = Double(total - bounds.upperBound) / sampleRate * 1000

            node.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) {
                [weak self] _ in
                self?.queue.async {
                    self?.completed(
                        generation: scheduledGeneration, index: index, chars: chars_,
                        bytes: bytes_, frames: frames, leadMs: leadMs, trailMs: trailMs,
                        startFrame: startFrame, enqueuedAtMs: enqueuedAt)
                }
            }

            return SpeechAck(
                dropped: false, leadMs: leadMs, trailMs: trailMs,
                queuedMs: Double(clock.queuedFrames) / sampleRate * 1000,
                startMs: Double(startFrame) / sampleRate * 1000)
        }
    }

    /// Cut the voice off. Reads the position first, because `stop()` resets the
    /// player's timeline and there is no reading it afterwards.
    @discardableResult
    func stop(reason: String) -> SpeechPosition {
        queue.sync { stopLocked(reason: reason) }
    }

    /// Where the voice is right now, or nil when it is not speaking.
    func position() -> SpeechPosition? {
        queue.sync {
            guard speaking else { return nil }
            return positionLocked()
        }
    }

    func report() -> SpeechReport {
        queue.sync { reportLocked() }
    }

    /// AudioFront took the stack apart — an interruption, a route that went
    /// away, the app leaving the screen. The queue goes; nothing is replayed and
    /// nothing resumes. What comes after an interruption is a new turn
    /// (docs/33).
    func lost() {
        queue.async {
            guard self.speaking || self.player != nil else { return }
            // The node is already detached by the time this runs, so the book is
            // closed without touching it.
            self.generation &+= 1
            self.player = nil
            self.pending = 0
            self.stops.append("lost")
            self.finishLocked(reason: "lost")
        }
    }

    // MARK: - Bench

    #if DEBUG
        func beginCapture(label: String, path: String, seconds: Double) {
            queue.sync {
                self.label = label
                releaseCaptureLocked()
                let capacity = Int(seconds * SpeechOut.sampleRate)
                capture = UnsafeMutablePointer<Int16>.allocate(capacity: capacity)
                captureCapacity = capacity
                captureCount = 0
                capturePath = path
            }
        }

        /// Writes what the tap collected and answers with how many frames it
        /// was. Called after the run has stopped, never during one.
        @discardableResult
        func flushCapture() -> Int {
            queue.sync {
                guard let capture = capture, let path = capturePath, captureCount > 0 else {
                    return 0
                }
                let data = Data(
                    bytes: UnsafeRawPointer(capture), count: captureCount * 2)
                do {
                    try data.write(to: URL(fileURLWithPath: path))
                } catch {
                    NSLog("RP-SPEECH capture write failed: %@", String(describing: error))
                }
                return captureCount
            }
        }

        private func releaseCaptureLocked() {
            capture?.deallocate()
            capture = nil
            captureCapacity = 0
            captureCount = 0
        }
    #endif

    func setLabel(_ value: String) {
        queue.sync { label = value }
    }

    // MARK: - On the queue

    private func attachedPlayer() throws -> AVAudioPlayerNode {
        if let player = player { return player }
        let speaker = try AudioFront.shared.acquireSpeaker { [weak self] in
            self?.lost()
        }
        let node = speaker.player
        // format: nil, always. This bus is already connected to the main mixer
        // and installing a tap with an explicit format on a connected bus is
        // refused. 100 ms of frames is the smallest the header allows.
        node.installTap(onBus: 0, bufferSize: SpeechOut.tapFrames, format: nil) {
            [weak self] buffer, _ in
            self?.meter(buffer)
        }
        player = node
        return node
    }

    private func beginLocked(utterance: UInt64) {
        speaking = true
        self.utterance = utterance
        generation &+= 1
        sawLast = false
        pending = 0
        startedAt = CFAbsoluteTimeGetCurrent()
        clock.reset(sampleRate: SpeechOut.sampleRate, baseMs: 0)
        rows.removeAll(keepingCapacity: true)
        levelDb.removeAll(keepingCapacity: true)
        levelAt.removeAll(keepingCapacity: true)
        lastLevelAt = 0
        firstTapFrames = 0
        tapBuffers = 0
        emit(kind: "speaking", value: 1, reason: nil)
    }

    private func stopLocked(reason: String) -> SpeechPosition {
        guard speaking, let node = player else {
            return SpeechPosition(
                speaking: false, utterance: utterance, index: -1, charOffset: 0, playedMs: 0)
        }
        let at = positionLocked()
        // Before stop(), so that the handlers stop() runs for the buffers it
        // discards are already stale when they arrive.
        generation &+= 1
        node.stop()
        pending = 0
        stops.append(reason)
        finishLocked(reason: reason)
        return at
    }

    /// Everything both endings share. The player node stays attached and the tap
    /// stays installed: the next turn is one `play()` away and rebuilding the
    /// connection would cost what AudioFront's pause is there to avoid.
    private func finishLocked(reason: String) {
        speaking = false
        AudioFront.shared.releaseSpeaker()
        emit(kind: "level", value: 0, reason: nil)
        emit(kind: "speaking", value: 0, reason: reason)
    }

    private func positionLocked() -> SpeechPosition {
        let frame = playedFrameLocked()
        let where_ = clock.locate(frame: frame)
        return SpeechPosition(
            speaking: speaking, utterance: utterance, index: where_?.index ?? -1,
            charOffset: where_?.charOffset ?? 0, playedMs: clock.msFor(frame: frame))
    }

    /// Frames of speech the listener has actually heard.
    ///
    /// `playerTime` counts what the node has handed downstream, which is ahead
    /// of the ear by however long the rest of the chain and the hardware hold
    /// on to it. `outputPresentationLatency` is read every time rather than
    /// cached: the header says it changes when the engine starts and stops and
    /// when connections change, and this engine does both between turns.
    private func playedFrameLocked() -> Int {
        guard let node = player, let render = node.lastRenderTime,
            let time = node.playerTime(forNodeTime: render)
        else { return 0 }
        let latency = Int((node.outputPresentationLatency * SpeechOut.sampleRate).rounded(.up))
        return max(0, Int(time.sampleTime) - latency)
    }

    private func completed(
        generation: UInt64, index: Int, chars: Int, bytes: Int, frames: Int, leadMs: Double,
        trailMs: Double, startFrame: Int, enqueuedAtMs: Double
    ) {
        guard generation == self.generation, speaking else { return }
        pending -= 1

        let completionFrame = playedFrameLocked()
        let endFrame = startFrame + frames
        rows.append(
            SpeechSentenceRow(
                index: index, chars: chars, bytes: bytes, frames: frames, leadMs: leadMs,
                trailMs: trailMs, startFrame: startFrame, completionFrame: completionFrame,
                latencyMs: Double(completionFrame - endFrame) / SpeechOut.sampleRate * 1000,
                enqueuedAtMs: enqueuedAtMs,
                completedAtMs: (CFAbsoluteTimeGetCurrent() - startedAt) * 1000))

        guard pending == 0 else { return }
        // The queue looks empty. Confirm it on a second pass through this same
        // queue rather than here: a sentence may be being scheduled right now,
        // in which case this is a gap between sentences and not the end of a
        // turn.
        let drainGeneration = self.generation
        queue.async { [weak self] in
            guard let self = self, self.speaking, self.pending == 0,
                drainGeneration == self.generation
            else { return }
            if !self.sawLast {
                self.underruns += 1
                NSLog("RP-SPEECH ran dry before the last sentence")
            }
            _ = self.stopLocked(reason: self.sawLast ? "done" : "underrun")
        }
    }

    private func reportLocked() -> SpeechReport {
        let session = AVAudioSession.sharedInstance()
        var captured = 0
        var path: String? = nil
        #if DEBUG
            captured = captureCount
            path = capturePath
        #endif
        return SpeechReport(
            label: label, sentences: rows, levelDb: levelDb, levelIntervalMs: levelAt,
            firstTapFrames: firstTapFrames, tapBuffers: tapBuffers, underruns: underruns,
            stops: stops,
            outputPresentationLatencyMs: (player?.outputPresentationLatency ?? 0) * 1000,
            sessionOutputLatencyMs: session.outputLatency * 1000,
            ioBufferDurationMs: session.ioBufferDuration * 1000,
            outputVolume: Double(session.outputVolume), sessionSampleRate: session.sampleRate,
            outputRoute: session.currentRoute.outputs.map { $0.portType.rawValue }.joined(
                separator: ","),
            playbackFormat: describeFormat(playbackFormat), capturedFrames: captured,
            capturePath: path)
    }

    // MARK: - The audio thread

    /// The player's own output bus, which is the orb's input and the bench's
    /// tape. Runs on the audio thread: no locks, no allocation.
    private func meter(_ buffer: AVAudioPCMBuffer) {
        let frames = Int(buffer.frameLength)
        guard frames > 0, let channel = buffer.floatChannelData?[0] else { return }

        var sum: Float = 0
        for i in 0..<frames {
            let v = channel[i]
            sum += v * v
        }
        let rms = (sum / Float(frames)).squareRoot()
        let db = rms > 0 ? 20 * log10(Double(rms)) : -160.0
        let mapped = max(
            0, min(1, (db - SpeechOut.quietDb) / (SpeechOut.loudDb - SpeechOut.quietDb)))
        let now = CFAbsoluteTimeGetCurrent()

        #if DEBUG
            if let capture = capture, captureCount + frames <= captureCapacity {
                for i in 0..<frames {
                    let clamped = max(-1.0, min(1.0, channel[i]))
                    capture[captureCount + i] = Int16(
                        (clamped * 32768.0).rounded().clamped(to: -32768...32767))
                }
                captureCount += frames
            }
        #endif

        queue.async { [weak self] in
            guard let self = self, self.speaking else { return }
            if self.tapBuffers == 0 {
                self.firstTapFrames = frames
                NSLog("RP-SPEECH first tap buffer %d frames", frames)
            }
            self.tapBuffers += 1
            self.levelDb.append(db)
            self.levelAt.append(self.lastLevelAt == 0 ? 0 : (now - self.lastLevelAt) * 1000)
            self.lastLevelAt = now
            self.emit(kind: "level", value: mapped, reason: nil)
        }
    }

    private func emit(kind: String, value: Double, reason: String?) {
        emitter?(kind, value, reason)
    }
}

extension Float {
    fileprivate func clamped(to range: ClosedRange<Float>) -> Float {
        Swift.min(Swift.max(self, range.lowerBound), range.upperBound)
    }
}
