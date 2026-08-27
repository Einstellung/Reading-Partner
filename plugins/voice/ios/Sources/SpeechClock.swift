// The two pieces of playback that are arithmetic rather than audio: where a
// sentence's speech starts and ends inside the bytes a vendor sent, and which
// sentence and which character the player is standing on right now.
//
// Nothing here imports AVFoundation. Both answers can be checked against the
// fixture manifest (docs/assets/tts-probe/manifest.json) without a device, and
// that is the point of keeping them apart from SpeechOut: a wrong trim and a
// wrong offset both look like "the audio is fine" from the outside.

import Foundation

/// The first and last sample of speech in one sentence, with a 20 ms guard band
/// left on either side.
///
/// A plain absolute gate at -45 dBFS over 10 ms frames, no hysteresis. Measured
/// on the twelve-sentence mimo fixture: the silence floor (5th-percentile frame)
/// sits at -59..-71 dBFS and speech peaks at -7..-12 dBFS, so the gate has more
/// than 14 dB of room on both sides, and an absolute gate at -45 or at -40
/// agrees with the -35/-45 hysteresis gate that built the fixture to within one
/// 10 ms frame on all twelve. The expected result on that fixture is a leading
/// trim averaging 91.7 ms and a trailing trim averaging 440.0 ms; the per
/// sentence numbers are the acceptance table.
///
/// Trimming is here rather than in Rust because it needs the whole sentence and
/// because vendors differ: mimo leaves 117/451 ms, DashScope 85/51 ms, and a
/// cloned voice jitters its leading silence by 90 ms (docs/pitfall/188). Rust
/// hands over the vendor's bytes unaltered and this decides what is speech.
///
/// A sentence with no frame above the gate is returned whole. That is a vendor
/// that sent silence, and dropping it would take a sentence out of the count the
/// clock keeps; a silent sentence that plays is visible, a missing one is not.
func speechBounds(_ samples: UnsafePointer<Int16>, count: Int, sampleRate: Double) -> Range<Int> {
    guard count > 0, sampleRate > 0 else { return 0..<count }

    let frame = max(1, Int(sampleRate * 0.01))
    let guardFrames = 2  // 20 ms
    // -45 dBFS as a squared-amplitude threshold, so the loop never calls log.
    let gateAmplitude = 32768.0 * pow(10.0, -45.0 / 20.0)
    let gateMeanSquare = gateAmplitude * gateAmplitude

    var firstLoud = -1
    var lastLoud = -1
    var start = 0
    while start < count {
        let end = min(start + frame, count)
        var sum = 0.0
        for i in start..<end {
            let v = Double(samples[i])
            sum += v * v
        }
        if sum / Double(end - start) >= gateMeanSquare {
            if firstLoud < 0 { firstLoud = start }
            lastLoud = end
        }
        start = end
    }

    guard firstLoud >= 0 else { return 0..<count }
    let lead = max(0, firstLoud - guardFrames * frame)
    let trail = min(count, lastLoud + guardFrames * frame)
    return lead..<trail
}

func speechBounds(_ samples: [Int16], sampleRate: Double) -> Range<Int> {
    samples.withUnsafeBufferPointer { buffer in
        guard let base = buffer.baseAddress else { return 0..<0 }
        return speechBounds(base, count: buffer.count, sampleRate: sampleRate)
    }
}

/// One book, kept in frames on the player's own timeline.
///
/// The zero is one `play()`, not one turn of conversation. The queue running dry
/// is a `stop()` (SpeechOut enforces it), so the next `play()` starts the count
/// again from zero with `baseMs` carrying whatever wall-clock offset the caller
/// wants reported. That is the only reason the accounting can be trusted: the
/// player's timeline keeps advancing through the silence after the last buffer
/// and through a starvation gap, and neither of those is speech.
struct SpeechClock {
    struct Segment {
        let index: Int
        let chars: Int
        let startFrame: Int
        let frames: Int
    }

    private(set) var segments: [Segment] = []
    private(set) var queuedFrames: Int = 0
    private var sampleRate: Double = 24000
    private var baseMs: Double = 0

    mutating func reset(sampleRate: Double, baseMs: Double) {
        segments.removeAll(keepingCapacity: true)
        queuedFrames = 0
        self.sampleRate = sampleRate
        self.baseMs = baseMs
    }

    /// Adds a sentence to the back of the book and answers with the frame it
    /// starts on. `scheduleBuffer(_:completionHandler:)` with no `when` plays
    /// buffers end to end with no silence inserted, which is what makes a plain
    /// running total the right answer.
    @discardableResult
    mutating func append(index: Int, chars: Int, frames: Int) -> Int {
        let startFrame = queuedFrames
        segments.append(
            Segment(index: index, chars: chars, startFrame: startFrame, frames: frames))
        queuedFrames += frames
        return startFrame
    }

    /// Which sentence and which character a frame on this timeline falls in.
    ///
    /// The character is linear inside the sentence. It is not where the voice
    /// really is — speech does not run at a constant characters per second — but
    /// the consumer is "resume from roughly where you were cut off", which
    /// docs/33 sizes at one or two characters, and the sentence boundary is
    /// exact either way.
    func locate(frame: Int) -> (index: Int, charOffset: Int)? {
        guard let first = segments.first else { return nil }
        if frame < first.startFrame { return (first.index, 0) }
        for segment in segments where frame < segment.startFrame + segment.frames {
            guard frame >= segment.startFrame else { continue }
            let into = frame - segment.startFrame
            let offset = segment.frames > 0 ? segment.chars * into / segment.frames : 0
            return (segment.index, min(segment.chars, offset))
        }
        guard let last = segments.last else { return nil }
        return (last.index, last.chars)
    }

    func msFor(frame: Int) -> Double {
        baseMs + Double(frame) / sampleRate * 1000
    }

    func segment(index: Int) -> Segment? {
        segments.first { $0.index == index }
    }

    /// The frame the given sentence ends on, which is what a played-back
    /// completion is compared against to get the output latency.
    func endFrame(index: Int) -> Int? {
        guard let segment = segment(index: index) else { return nil }
        return segment.startFrame + segment.frames
    }
}
