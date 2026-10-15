// The neural half of the call's audio front (docs/136): Silero VAD v6 says
// whether each 32 ms of the microphone is speech, and Smart Turn v3.2 says
// whether a turn that went quiet is over. Both are compiled CoreML models that
// Tauri bundles from src-tauri/voice-models/ (scripts/fetch-voice-models.sh),
// loaded once per call. The energy path in VoiceTurn.swift stays beside this
// for the A/B; ConversationRun picks one at start.
//
// Threads. The tap converts its buffer to 16 kHz mono — the conversion every
// run here does, one allocation — and hands the samples to `queue`. Everything
// else runs there in order: the VAD per frame, the ring of the last 8 s, and
// Smart Turn. Each frame goes to the turn machine stamped with its own time,
// worked back from the buffer's stamp, so speech starts and stops at 32 ms
// resolution rather than at the tap's 100-200 ms: a 0.35 s 「等一下」 spans
// the 300 ms confirm window frame by frame, where two buffers did not.

import AVFoundation
import CoreML
import Foundation

/// A frame-level speech detector. Silero is the one in use; FireRedVAD
/// (docs/research/语音交互调研.md) is the other candidate and plugs in here.
protocol VoiceActivityModel: AnyObject {
    /// Samples per frame, 16 kHz mono.
    var frameSamples: Int { get }
    /// Probability that this frame is speech; exactly `frameSamples` long.
    /// The model carries its own state from one frame to the next.
    func probability(_ frame: UnsafeBufferPointer<Float>) throws -> Double
}

struct VoiceModelError: Error, CustomStringConvertible {
    let description: String
}

enum VoiceModels {
    /// Where Tauri puts `bundle.resources` on iOS: `assets/` inside the app.
    static func url(_ name: String) -> URL {
        Bundle.main.bundleURL.appendingPathComponent("assets/voice-models/\(name)")
    }

    static func load(_ name: String, units: MLComputeUnits) throws -> MLModel {
        let config = MLModelConfiguration()
        config.computeUnits = units
        return try MLModel(contentsOf: url(name), configuration: config)
    }

    /// A float32 array of zeros; `MLMultiArray(shape:dataType:)` leaves its
    /// contents uninitialised.
    static func zeros(_ shape: [Int]) throws -> MLMultiArray {
        let array = try MLMultiArray(shape: shape.map { NSNumber(value: $0) }, dataType: .float32)
        array.dataPointer.assumingMemoryBound(to: Float.self)
            .update(repeating: 0, count: array.count)
        return array
    }

    static func value(_ out: MLFeatureProvider, _ name: String) throws -> MLMultiArray {
        guard let array = out.featureValue(for: name)?.multiArrayValue else {
            throw VoiceModelError(description: "The model gave no \(name).")
        }
        return array
    }
}

/// Silero VAD v6, FluidInference's CoreML conversion of the 32 ms model: 512
/// new samples behind the last 64 of the previous frame, and the LSTM's two
/// states carried across calls.
final class SileroVAD: VoiceActivityModel {
    private static let frame = 512
    private static let context = 64

    var frameSamples: Int { Self.frame }

    private let model: MLModel
    private let input: MLMultiArray
    private var hidden: MLMultiArray
    private var cell: MLMultiArray

    init() throws {
        // An LSTM this small loses more to the hop onto the Neural Engine than
        // it gains there.
        model = try VoiceModels.load("silero-vad.mlmodelc", units: .cpuOnly)
        input = try VoiceModels.zeros([1, Self.context + Self.frame])
        hidden = try VoiceModels.zeros([1, 128])
        cell = try VoiceModels.zeros([1, 128])
    }

    func probability(_ frame: UnsafeBufferPointer<Float>) throws -> Double {
        guard frame.count == Self.frame, let samples = frame.baseAddress else {
            throw VoiceModelError(description: "Silero takes \(Self.frame) samples, got \(frame.count).")
        }
        let window = input.dataPointer.assumingMemoryBound(to: Float.self)
        // The previous frame's tail is the new window's head.
        window.update(from: window.advanced(by: Self.frame), count: Self.context)
        window.advanced(by: Self.context).update(from: samples, count: Self.frame)
        let out = try model.prediction(
            from: MLDictionaryFeatureProvider(dictionary: [
                "audio_input": MLFeatureValue(multiArray: input),
                "hidden_state": MLFeatureValue(multiArray: hidden),
                "cell_state": MLFeatureValue(multiArray: cell),
            ]))
        hidden = try VoiceModels.value(out, "new_hidden_state")
        cell = try VoiceModels.value(out, "new_cell_state")
        return try VoiceModels.value(out, "vad_output")[0].doubleValue
    }
}

/// Smart Turn v3.2, aufklarer's CoreML conversion with the Whisper mel front
/// end inside: 8 s of raw 16 kHz audio in, most recent last and zeros in
/// front, one probability out that the speaker has finished.
final class SmartTurn {
    static let windowSamples = 128_000
    /// The model card's line: above it, the turn is complete.
    static let threshold = 0.5

    private let model: MLModel
    private let input: MLMultiArray

    init() throws {
        model = try VoiceModels.load("smart-turn.mlmodelc", units: .cpuAndNeuralEngine)
        input = try VoiceModels.zeros([1, Self.windowSamples])
    }

    /// The turn's audio, oldest first; only the last 8 s are read.
    func probability(_ samples: [Float]) throws -> Double {
        let tail = samples.suffix(Self.windowSamples)
        let pad = Self.windowSamples - tail.count
        let window = input.dataPointer.assumingMemoryBound(to: Float.self)
        window.update(repeating: 0, count: pad)
        tail.withUnsafeBufferPointer { source in
            if let base = source.baseAddress {
                window.advanced(by: pad).update(from: base, count: source.count)
            }
        }
        let out = try model.prediction(
            from: MLDictionaryFeatureProvider(dictionary: ["audio": MLFeatureValue(multiArray: input)]))
        return try VoiceModels.value(out, "probability")[0].doubleValue
    }
}

final class NeuralFront {
    /// One frame's verdict for the turn machine: the level of the buffer it
    /// came from, its own wall-clock and audio-timeline stamps, and the VAD's
    /// probability (NaN when the model failed on it).
    typealias Step = (_ db: Double, _ atMs: Double, _ audioMs: Double, _ speech: Double) -> Void

    /// What Smart Turn said about one pause. `probability` is nil when the
    /// model is not loaded or failed; `ms` is the prediction alone.
    struct Judgement {
        let probability: Double?
        let ms: Double
        let audioMs: Double
    }

    private static let rate: Double = 16000
    /// Audio from before the duck that still belongs to the turn: the first
    /// syllable starts under the VAD's line.
    private static let prerollMs: Double = 200

    private let queue = DispatchQueue(label: "rp.voice.neural", qos: .userInitiated)
    private let vad: VoiceActivityModel
    private let step: Step
    private let format = AVAudioFormat(
        commonFormat: .pcmFormatFloat32, sampleRate: NeuralFront.rate, channels: 1,
        interleaved: false)!

    // The tap's thread only.
    private var converter: AVAudioConverter?
    private var loggedConversionFailure = false

    // `queue` only.
    private var smartTurn: SmartTurn?
    private var pending: [Float] = []
    private var ring = [Float](repeating: 0, count: SmartTurn.windowSamples)
    private var ringNext = 0
    private var ringFilled = 0
    private var ringEndAudioMs: Double = 0
    private var loggedVadFailure = false

    /// Loads the VAD now, because the call cannot hear without it; throws if
    /// it will not load, and the caller falls back to the energy path.
    init(step: @escaping Step) throws {
        vad = try SileroVAD()
        self.step = step
    }

    /// Smart Turn is the larger load, and the Neural Engine compiles it on
    /// first use, so it comes up behind the call's start. A pause before it is
    /// up is left to the fallback.
    func loadSmartTurn() {
        queue.async { [weak self] in
            let began = CFAbsoluteTimeGetCurrent()
            do {
                self?.smartTurn = try SmartTurn()
                let ms = (CFAbsoluteTimeGetCurrent() - began) * 1000
                NSLog("RP-CALL smart turn loaded in %.0fms", ms)
                VoiceHarness.shared.log("smart-turn-loaded", ["ms": ms])
            } catch {
                NSLog("RP-CALL smart turn would not load: %@", DictationError.describe(error))
            }
        }
    }

    // MARK: - The tap

    /// One tap buffer, on the tap's thread, with its level and the two stamps
    /// the tap took for its last sample. The frames are judged on `queue`.
    func push(_ buffer: AVAudioPCMBuffer, db: Double, atMs: Double, audioMs: Double) {
        guard let samples = resample(buffer) else { return }
        queue.async { [weak self] in
            self?.judge(samples, db: db, atMs: atMs, audioMs: audioMs)
        }
    }

    private func resample(_ buffer: AVAudioPCMBuffer) -> [Float]? {
        if converter == nil {
            converter = AVAudioConverter(from: buffer.format, to: format)
        }
        guard let converter = converter else {
            logConversionFailure("no converter from \(describeFormat(buffer.format))")
            return nil
        }
        let ratio = format.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 1024
        guard let converted = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
            return nil
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
            logConversionFailure(conversionError.map { DictationError.describe($0) } ?? "no detail")
            return nil
        }
        guard converted.frameLength > 0, let channel = converted.floatChannelData?[0] else {
            return nil
        }
        return Array(UnsafeBufferPointer(start: channel, count: Int(converted.frameLength)))
    }

    private func logConversionFailure(_ detail: String) {
        guard !loggedConversionFailure else { return }
        loggedConversionFailure = true
        NSLog("RP-CALL 16 kHz conversion for the VAD failed: %@", detail)
    }

    // MARK: - The queue

    private func judge(_ samples: [Float], db: Double, atMs: Double, audioMs: Double) {
        remember(samples, endAudioMs: audioMs)
        pending.append(contentsOf: samples)
        let size = vad.frameSamples
        var used = 0
        while pending.count - used >= size {
            let end = used + size
            // How far this frame's last sample is behind the buffer's.
            let behindMs = Double(pending.count - end) / Self.rate * 1000
            var speech = Double.nan
            do {
                speech = try pending.withUnsafeBufferPointer { all in
                    try vad.probability(UnsafeBufferPointer(rebasing: all[used..<end]))
                }
            } catch {
                if !loggedVadFailure {
                    loggedVadFailure = true
                    NSLog("RP-CALL the VAD failed on a frame: %@", DictationError.describe(error))
                }
            }
            step(db, atMs - behindMs, audioMs - behindMs, speech)
            used = end
        }
        pending.removeFirst(used)
    }

    private func remember(_ samples: [Float], endAudioMs: Double) {
        for sample in samples {
            ring[ringNext] = sample
            ringNext = (ringNext + 1) % ring.count
        }
        ringFilled = min(ring.count, ringFilled + samples.count)
        ringEndAudioMs = endAudioMs
    }

    /// The last `count` samples heard, oldest first.
    private func recent(_ count: Int) -> [Float] {
        let n = min(count, ringFilled)
        let start = (ringNext - n + ring.count) % ring.count
        if start + n <= ring.count {
            return Array(ring[start..<(start + n)])
        }
        return Array(ring[start...] + ring[..<(start + n - ring.count)])
    }

    /// Smart Turn on the turn's audio, from `fromAudioMs` (where its duck fell)
    /// less the preroll, to the last sample heard, capped at 8 s. Answers on
    /// `queue`.
    func judgeTurn(fromAudioMs: Double, _ done: @escaping (Judgement) -> Void) {
        queue.async { [weak self] in
            guard let self = self else { return }
            let spanMs = self.ringEndAudioMs - fromAudioMs + Self.prerollMs
            let count = min(self.ringFilled, max(0, Int(spanMs / 1000 * Self.rate)))
            let audioMs = Double(count) / Self.rate * 1000
            guard let model = self.smartTurn else {
                done(Judgement(probability: nil, ms: 0, audioMs: audioMs))
                return
            }
            let audio = self.recent(count)
            let began = CFAbsoluteTimeGetCurrent()
            var probability: Double?
            do {
                probability = try model.probability(audio)
            } catch {
                NSLog("RP-CALL smart turn failed: %@", DictationError.describe(error))
            }
            done(
                Judgement(
                    probability: probability, ms: (CFAbsoluteTimeGetCurrent() - began) * 1000,
                    audioMs: audioMs))
        }
    }
}
