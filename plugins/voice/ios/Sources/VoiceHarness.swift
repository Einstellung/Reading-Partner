// The silent bench for the voice call (docs/platform/560, 静默语音测试). Debug
// builds only: the `voice_harness` command refuses everywhere else, and nothing
// in this file runs until it is armed.
//
// Armed, three things change and nothing else does:
//
// - The microphone is never opened. AudioFront builds a playback-only stack and
//   this file's feeder calls the same `deliver` the input tap calls, with
//   4800-frame 48 kHz buffers every 100 ms (the tap's real size, pitfall 161),
//   so the level detector, the turn machine and SpeechAnalyzer see what they
//   would see from a person, cut from WAV clips instead.
// - The speaker is silent. The player feeds a mixer of its own, that mixer
//   feeds the main mixer, and the main mixer's output volume is 0. The tap on
//   the player's mixer records what would have been heard.
// - Every event worth timing is written to `native.jsonl` on one clock,
//   CLOCK_UPTIME_RAW in milliseconds — the clock `mach_absolute_time` and an
//   AVAudioTime's host time count, and the one src/harness.rs stamps the Rust
//   and webview rows with.

import AVFoundation
import Foundation

enum HarnessClock {
    static func nowMs() -> Double {
        Double(clock_gettime_nsec_np(CLOCK_UPTIME_RAW)) / 1_000_000
    }

    static func ms(hostTime: UInt64) -> Double {
        AVAudioTime.seconds(forHostTime: hostTime) * 1000
    }
}

struct HarnessArgs: Decodable {
    let op: String
    let dir: String?
    let path: String?
    let name: String?
}

struct HarnessAck: Encodable {
    let dir: String?
    let t: Double
}

struct HarnessClipResult: Encodable {
    let name: String
    let startMs: Double
    let speechEndMs: Double
    let endMs: Double
    let durationMs: Double
}

/// A 16-bit mono WAV written as it grows, with the sizes patched in on close.
private final class WavWriter {
    private let handle: FileHandle
    private let rate: Int
    private var bytes = 0

    init?(path: String, rate: Int) {
        guard FileManager.default.createFile(atPath: path, contents: nil),
            let handle = FileHandle(forWritingAtPath: path)
        else { return nil }
        self.handle = handle
        self.rate = rate
        handle.write(header(dataBytes: 0))
    }

    func append(_ samples: [Float]) {
        var data = Data(count: samples.count * 2)
        data.withUnsafeMutableBytes { raw in
            let out = raw.bindMemory(to: Int16.self)
            for i in 0..<samples.count {
                let v = max(-1, min(1, samples[i]))
                out[i] = Int16(max(-32768, min(32767, (v * 32767).rounded()))).littleEndian
            }
        }
        handle.write(data)
        bytes += data.count
    }

    func close() {
        handle.seek(toFileOffset: 0)
        handle.write(header(dataBytes: bytes))
        handle.closeFile()
    }

    private func header(dataBytes: Int) -> Data {
        var d = Data()
        func u32(_ v: Int) { var x = UInt32(v).littleEndian; d.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: Int) { var x = UInt16(v).littleEndian; d.append(Data(bytes: &x, count: 2)) }
        d.append("RIFF".data(using: .ascii)!)
        u32(36 + dataBytes)
        d.append("WAVEfmt ".data(using: .ascii)!)
        u32(16)
        u16(1)
        u16(1)
        u32(rate)
        u32(rate * 2)
        u16(2)
        u16(16)
        d.append("data".data(using: .ascii)!)
        u32(dataBytes)
        return d
    }
}

final class VoiceHarness {
    static let shared = VoiceHarness()

    static let inputRate: Double = 48000
    static let tickFrames: AVAudioFrameCount = 4800
    static let inputFormat = AVAudioFormat(standardFormatWithSampleRate: inputRate, channels: 1)!
    /// Room tone under the clips. -75 dBFS is the measured median of a quiet
    /// room through the real tap (docs/info/33); digital silence would put
    /// `-inf` into the detector, which no microphone ever does.
    private static let noiseAmp: Float = Float(pow(10.0, -75.0 / 20.0) * 3.0.squareRoot())
    /// Output windows for "is the voice audible": 10 ms, -50 dBFS, and 300 ms
    /// of quiet before a sound counts as a new start. The relay pads sentences
    /// with 160 ms, so one reply is one start and one end.
    private static let audibleDb: Double = -50
    private static let audibleGapMs: Double = 300

    private let lock = NSLock()
    private var dir: URL?
    private let io = DispatchQueue(label: "com.readingpartner.voice.harness.io")
    private var logHandle: FileHandle?
    private var outWav: WavWriter?
    private var inWav: WavWriter?
    private var outputLatencyMs: Double = 0

    private let feedQueue = DispatchQueue(
        label: "com.readingpartner.voice.harness.feed", qos: .userInteractive)
    private var timer: DispatchSourceTimer?
    private var sink: ((AVAudioPCMBuffer) -> Void)?
    private var clips: [Clip] = []

    // Output state, touched only on `io`.
    private var captureStarted = false
    private var loud = false
    private var lastLoudMs: Double = 0
    private var outFramesSeen = 0

    private final class Clip {
        let name: String
        let samples: [Float]
        let speechEnd: Int
        var cursor = 0
        var startMs: Double = 0
        var speechEndMs: Double?
        let done: (HarnessClipResult) -> Void

        init(name: String, samples: [Float], speechEnd: Int, done: @escaping (HarnessClipResult) -> Void) {
            self.name = name
            self.samples = samples
            self.speechEnd = speechEnd
            self.done = done
        }
    }

    private init() {}

    var isArmed: Bool {
        lock.lock()
        defer { lock.unlock() }
        return dir != nil
    }

    // MARK: - Arm and disarm

    func arm(dir path: String) throws {
        let url = URL(fileURLWithPath: path, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        let logPath = url.appendingPathComponent("native.jsonl").path
        FileManager.default.createFile(atPath: logPath, contents: nil)
        guard let handle = FileHandle(forWritingAtPath: logPath) else {
            throw DictationError("The harness log could not be opened at \(logPath).")
        }
        let session = AVAudioSession.sharedInstance()
        io.sync {
            logHandle = handle
            outWav = WavWriter(path: url.appendingPathComponent("output.wav").path, rate: 24000)
            inWav = WavWriter(path: url.appendingPathComponent("input.wav").path, rate: 16000)
            captureStarted = false
            loud = false
            outFramesSeen = 0
        }
        lock.lock()
        dir = url
        lock.unlock()
        // Read again when the stack is built: the category changes both.
        outputLatencyMs = (session.outputLatency + session.ioBufferDuration) * 1000
        log("armed", ["dir": url.path])
    }

    func disarm() -> String? {
        lock.lock()
        let was = dir
        dir = nil
        let pending = clips
        clips.removeAll()
        lock.unlock()
        for clip in pending {
            clip.done(HarnessClipResult(
                name: clip.name, startMs: clip.startMs, speechEndMs: -1, endMs: -1, durationMs: 0))
        }
        log("disarmed", [:], force: true)
        io.sync {
            outWav?.close()
            inWav?.close()
            logHandle?.closeFile()
            outWav = nil
            inWav = nil
            logHandle = nil
        }
        return was?.path
    }

    // MARK: - The log

    func log(_ ev: String, at t: Double = HarnessClock.nowMs(), _ fields: [String: Any] = [:], force: Bool = false) {
        guard force || isArmed else { return }
        var row: [String: Any] = [:]
        for (k, v) in fields {
            if let d = v as? Double, !d.isFinite { continue }
            row[k] = v
        }
        row["t"] = t
        row["src"] = "native"
        row["ev"] = ev
        guard JSONSerialization.isValidJSONObject(row),
            let data = try? JSONSerialization.data(withJSONObject: row, options: [.sortedKeys])
        else { return }
        io.async { [weak self] in
            guard let handle = self?.logHandle else { return }
            handle.write(data)
            handle.write(Data([0x0A]))
        }
    }

    /// An event the plugin is about to send to the webview, stamped here
    /// rather than where the webview hears it.
    func logEvent<E: Encodable>(_ prefix: String, _ event: E) {
        guard isArmed else { return }
        let t = HarnessClock.nowMs()
        guard let data = try? JSONEncoder().encode(event),
            var fields = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return }
        let kind = fields["kind"] as? String ?? "?"
        if kind == "level" || kind == "envelope" { return }
        if let text = fields["text"] as? String { fields["text"] = String(text.prefix(200)) }
        fields.removeValue(forKey: "values")
        log("\(prefix):\(kind)", at: t, fields)
    }

    // MARK: - The microphone that is not one

    func startFeeding(_ deliver: @escaping (AVAudioPCMBuffer) -> Void) {
        stopFeeding()
        lock.lock()
        sink = deliver
        lock.unlock()
        let timer = DispatchSource.makeTimerSource(flags: .strict, queue: feedQueue)
        timer.schedule(
            deadline: .now(), repeating: .milliseconds(100), leeway: .milliseconds(1))
        timer.setEventHandler { [weak self] in self?.tick() }
        timer.resume()
        self.timer = timer
        log("feeder-started", ["rate": Self.inputRate, "frames": Int(Self.tickFrames)])
    }

    func stopFeeding() {
        timer?.cancel()
        timer = nil
        lock.lock()
        sink = nil
        lock.unlock()
    }

    /// Queues a clip behind whatever is playing and answers when its last
    /// sample has been delivered. Times are when the audio "happened", the way a
    /// tap's are: a buffer delivered at T holds the 100 ms before T.
    func feed(path: String, name: String) async throws -> HarnessClipResult {
        guard isArmed else { throw DictationError("The harness is not armed.") }
        let samples = try Self.load(path: path)
        let speechEnd = Self.speechEnd(samples)
        return await withCheckedContinuation { continuation in
            let clip = Clip(name: name, samples: samples, speechEnd: speechEnd) { result in
                continuation.resume(returning: result)
            }
            lock.lock()
            clips.append(clip)
            let feeding = sink != nil
            lock.unlock()
            log("clip-queued", ["name": name, "frames": samples.count, "feeding": feeding])
        }
    }

    private func tick() {
        guard let buffer = AVAudioPCMBuffer(pcmFormat: Self.inputFormat, frameCapacity: Self.tickFrames)
        else { return }
        let n = Int(Self.tickFrames)
        buffer.frameLength = Self.tickFrames
        let out = buffer.floatChannelData![0]
        for i in 0..<n { out[i] = Float.random(in: -Self.noiseAmp...Self.noiseAmp) }
        let now = HarnessClock.nowMs()
        let frameMs = 1000 / Self.inputRate
        let startMs = now - Double(n) * frameMs
        var started: [Clip] = []
        var finished: [Clip] = []

        lock.lock()
        var pos = 0
        while pos < n, let clip = clips.first {
            if clip.cursor == 0 {
                clip.startMs = startMs + Double(pos) * frameMs
                started.append(clip)
            }
            let take = min(n - pos, clip.samples.count - clip.cursor)
            clip.samples.withUnsafeBufferPointer { src in
                for k in 0..<take { out[pos + k] += src[clip.cursor + k] }
            }
            if clip.speechEndMs == nil, clip.cursor + take >= clip.speechEnd {
                clip.speechEndMs = startMs + Double(pos + clip.speechEnd - clip.cursor) * frameMs
            }
            clip.cursor += take
            pos += take
            if clip.cursor >= clip.samples.count {
                clips.removeFirst()
                finished.append(clip)
            }
        }
        let target = sink
        lock.unlock()

        target?(buffer)
        let copy = stride(from: 0, to: n, by: 3).map { out[$0] }
        io.async { [weak self] in self?.inWav?.append(copy) }

        for clip in started {
            log("clip-start", at: clip.startMs, ["name": clip.name])
        }
        for clip in finished {
            let endMs = startMs + Double(pos) * frameMs
            let speechEndMs = clip.speechEndMs ?? endMs
            log("clip-speech-end", at: speechEndMs, ["name": clip.name])
            log("clip-end", at: endMs, ["name": clip.name])
            clip.done(HarnessClipResult(
                name: clip.name, startMs: clip.startMs, speechEndMs: speechEndMs, endMs: endMs,
                durationMs: Double(clip.samples.count) * frameMs))
        }
    }

    /// Any WAV AVAudioFile reads, as 48 kHz mono float.
    private static func load(path: String) throws -> [Float] {
        let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
        let source = file.processingFormat
        guard let whole = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: AVAudioFrameCount(file.length))
        else { throw DictationError("The clip at \(path) is empty.") }
        try file.read(into: whole)
        guard let converter = AVAudioConverter(from: source, to: inputFormat) else {
            throw DictationError("No converter from \(describeFormat(source)) for \(path).")
        }
        let ratio = inputRate / source.sampleRate
        let capacity = AVAudioFrameCount(Double(whole.frameLength) * ratio) + 4096
        guard let converted = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: capacity) else {
            throw DictationError("The clip at \(path) could not be converted.")
        }
        var given = false
        var error: NSError?
        let status = converter.convert(to: converted, error: &error) { _, outStatus in
            if given {
                outStatus.pointee = .endOfStream
                return nil
            }
            given = true
            outStatus.pointee = .haveData
            return whole
        }
        if status == .error {
            throw DictationError(
                "The clip at \(path) did not convert: \(error.map { DictationError.describe($0) } ?? "")")
        }
        let p = converted.floatChannelData![0]
        return Array(UnsafeBufferPointer(start: p, count: Int(converted.frameLength)))
    }

    /// One past the last 10 ms window louder than -45 dBFS: where the speaker
    /// stopped, which is what "the user finished" is measured from.
    private static func speechEnd(_ samples: [Float]) -> Int {
        let window = Int(inputRate / 100)
        let threshold = Float(pow(10.0, -45.0 / 20.0))
        var end = 0
        var i = 0
        while i < samples.count {
            let upto = min(samples.count, i + window)
            var sum: Float = 0
            for k in i..<upto { sum += samples[k] * samples[k] }
            if (sum / Float(upto - i)).squareRoot() > threshold { end = upto }
            i = upto
        }
        return end
    }

    // MARK: - The speaker that is not one

    func stackBuilt(outputLatencyMs: Double) {
        self.outputLatencyMs = outputLatencyMs
        log("front-built", ["outputLatencyMs": outputLatencyMs])
    }

    /// The tap on the player's mixer. Audio thread: copy and leave.
    func capture(_ buffer: AVAudioPCMBuffer, when: AVAudioTime) {
        let frames = Int(buffer.frameLength)
        guard frames > 0, let channel = buffer.floatChannelData?[0] else { return }
        let samples = Array(UnsafeBufferPointer(start: channel, count: frames))
        let rate = buffer.format.sampleRate
        let atMs =
            when.isHostTimeValid
            ? HarnessClock.ms(hostTime: when.hostTime)
            : HarnessClock.nowMs() - Double(frames) / rate * 1000
        io.async { [weak self] in self?.captured(samples, rate: rate, atMs: atMs) }
    }

    private func captured(_ samples: [Float], rate: Double, atMs: Double) {
        guard outWav != nil else { return }
        if !captureStarted {
            captureStarted = true
            log("capture-start", at: atMs, ["rate": rate, "outputLatencyMs": outputLatencyMs])
        }
        outWav?.append(samples)
        let window = max(1, Int(rate / 100))
        let threshold = Float(pow(10.0, Self.audibleDb / 20))
        var i = 0
        while i < samples.count {
            let upto = min(samples.count, i + window)
            var sum: Float = 0
            for k in i..<upto { sum += samples[k] * samples[k] }
            let isLoud = (sum / Float(upto - i)).squareRoot() > threshold
            // When this window reaches the ear: rendered at atMs, out of the
            // hardware an output latency later.
            let windowMs = atMs + Double(i) / rate * 1000 + outputLatencyMs
            if isLoud {
                if !loud {
                    loud = true
                    log("audible-start", at: windowMs, ["renderedMs": windowMs - outputLatencyMs])
                }
                lastLoudMs = windowMs + Double(upto - i) / rate * 1000
            } else if loud, windowMs - lastLoudMs >= Self.audibleGapMs {
                loud = false
                log("audible-end", at: lastLoudMs, [:])
            }
            i = upto
        }
        outFramesSeen += samples.count
    }
}
