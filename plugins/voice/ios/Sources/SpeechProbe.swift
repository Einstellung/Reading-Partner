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

    static func setVoiceProcessing(_ vpio: Bool?) {
        guard let vpio = vpio, AudioFront.voiceProcessingOverride != vpio else { return }
        AudioFront.voiceProcessingOverride = vpio
        AudioFront.shared.close()
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
