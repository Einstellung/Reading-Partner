// The half of playback that is arithmetic rather than audio: which sentence and
// which character the player is standing on right now.
//
// Nothing here imports AVFoundation, so the account can be checked without a
// device, and that is the point of keeping it apart from SpeechOut: a wrong
// offset looks like "the audio is fine" from the outside.
//
// Trimming was here and is not any more. The threshold is a property of the
// vendor's audio — the lead-out is room tone at -45..-65 dBFS, not silence
// (docs/pitfall/191) — so it belongs beside the vendor, in
// src/tts/trim.rs, where it runs on a desktop and is covered by tests. What
// arrives here is already trimmed and already carries the pause that follows
// the sentence.

import Foundation

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
