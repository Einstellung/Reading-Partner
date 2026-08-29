// The half of a voice run that is not audio: which locale to recognise in,
// which model that locale needs, what format the analyzer accepts, whether the
// microphone may be opened at all, and how two recognised fragments are joined
// back into a sentence. None of it reads a run's state, so a press-and-hold run
// and a full-duplex conversation run call the same copies instead of keeping
// two that drift.
//
// Two of these look like they could be shorter and cannot, and both were
// measured rather than reasoned (docs/33): AssetInventory is asked on every
// run, because the system drops an unused model again on its own, and locale
// matching walks `supportedLocales` itself, because
// `supportedLocale(equivalentTo:)` answers with locales that are not in that
// list at all.

import AVFoundation
import Foundation
import Speech

enum Recogniser {
    // A space goes into a seam unless a CJK character sits on either side of it.
    // The webview's joinSpeech is the same rule over the same ranges; the two
    // have to agree, because stop_dictation's answer never passes through it.
    private static let cjkRanges: [ClosedRange<UInt32>] = [
        0x2E80...0x303F, 0x3040...0x30FF, 0x3400...0x4DBF,
        0x4E00...0x9FFF, 0xF900...0xFAFF, 0xFE30...0xFE4F, 0xFF00...0xFFEF,
    ]

    private static func isCJK(_ scalar: Unicode.Scalar) -> Bool {
        cjkRanges.contains { $0.contains(scalar.value) }
    }

    static func joinSpeech(_ left: String, _ right: String) -> String {
        if left.isEmpty { return right }
        if right.isEmpty { return left }
        guard let last = left.unicodeScalars.last, let first = right.unicodeScalars.first else {
            return left + right
        }
        let whitespace = CharacterSet.whitespacesAndNewlines
        let seam =
            whitespace.contains(last) || whitespace.contains(first) || isCJK(last) || isCJK(first)
            ? "" : " "
        return left + seam + right
    }

    // MARK: - Locale

    /// Membership in `supportedLocales` is the only test that means anything.
    /// `Locale.current` can carry a region override whose identifier does not
    /// construct, and `supportedLocale(equivalentTo:)` answers with locales that
    /// are not in the list at all (docs/33). Apple's own documentation says to
    /// use the latter; the device says otherwise.
    static func match(_ tag: String, in locales: [Locale]) -> Locale? {
        let wanted = normalise(tag)
        return locales.first { normalise($0.identifier(.bcp47)) == wanted }
    }

    private static func normalise(_ tag: String) -> String {
        tag.replacingOccurrences(of: "_", with: "-").lowercased()
    }

    /// Without a locale from the composer — which is the normal case, the bar
    /// never passes one — walk the device's own preference order and take the
    /// first supported one.
    static func resolveLocale(_ tag: String?) async throws -> Locale {
        let supported = await SpeechTranscriber.supportedLocales

        if let tag = tag {
            guard let locale = Self.match(tag, in: supported) else {
                throw DictationError(
                    "This iPhone cannot dictate in \(tag). Add the language in Settings, or speak "
                        + "one it already knows.")
            }
            return locale
        }

        for preferred in Locale.preferredLanguages {
            if let locale = Self.match(preferred, in: supported) {
                NSLog("RP-DICT locale from preferredLanguages: %@", locale.identifier(.bcp47))
                return locale
            }
        }
        guard let fallback = Self.match("en-US", in: supported) else {
            throw DictationError("This iPhone has no dictation language installed.")
        }
        NSLog("RP-DICT locale fell back to en-US")
        return fallback
    }

    // MARK: - Transcriber and model

    /// Options are fixed rather than parameterised: docs/33 already decided
    /// them. `.audioTimeRange` stays on even though the event drops the numbers,
    /// because barge-in truncation wants it later.
    static func makeTranscriber(locale: Locale) -> SpeechTranscriber {
        SpeechTranscriber(
            locale: locale,
            transcriptionOptions: [],
            reportingOptions: [.volatileResults, .fastResults],
            attributeOptions: [.transcriptionConfidence, .audioTimeRange])
    }

    static func installModelIfNeeded(for transcriber: SpeechTranscriber, locale: Locale) async
        throws
    {
        let request: AssetInstallationRequest?
        do {
            request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber])
        } catch {
            throw DictationError(
                "The dictation model is unavailable: \(DictationError.describe(error))")
        }
        guard let request = request else { return }

        NSLog("RP-DICT downloading the model for %@", locale.identifier(.bcp47))
        let began = CFAbsoluteTimeGetCurrent()
        do {
            try await request.downloadAndInstall()
        } catch {
            throw DictationError(
                "The dictation model could not be downloaded. Check the network and hold again.")
        }
        NSLog(
            "RP-DICT model installed in %.0fms", (CFAbsoluteTimeGetCurrent() - began) * 1000)
    }

    /// Apple's contextual-strings API degrades past about a hundred entries and
    /// the composer sends an uncapped `glossary.split('\n')`. Truncate and say
    /// so; never fail a start over hot words.
    static func capContextualStrings(_ strings: [String]) -> [String] {
        let cleaned =
            strings
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .map { $0.count > 100 ? String($0.prefix(100)) : $0 }
        if cleaned.count <= 100 { return cleaned }
        NSLog("RP-DICT contextualStrings capped from %d to 100", cleaned.count)
        return Array(cleaned.prefix(100))
    }

    // MARK: - Audio session and formats

    static func resolveAnalyzerFormat(for transcriber: SpeechTranscriber) async throws
        -> AVAudioFormat
    {
        guard let best = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber])
        else {
            throw DictationError("The recognizer would not name an audio format it accepts.")
        }
        return best
    }

    /// The same line AudioFront prints, so a format quoted in an error and a
    /// format quoted in the log can be compared character for character.
    static func describe(_ format: AVAudioFormat) -> String {
        describeFormat(format)
    }

    // MARK: - Permission

    static func ensureMicrophonePermission() async throws {
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            return
        case .denied:
            throw DictationError("Microphone access is off. Turn it on in Settings.")
        case .undetermined:
            // The alert steals the touch, so this hold is lost whatever happens
            // — the pointer is cancelled and the composer cancels the run. Ask
            // anyway, so the next hold works, and say a sentence instead of
            // nothing.
            _ = await withCheckedContinuation {
                (continuation: CheckedContinuation<Bool, Never>) in
                AVAudioApplication.requestRecordPermission { granted in
                    continuation.resume(returning: granted)
                }
            }
            throw DictationError("Microphone access is needed. Press and hold again.")
        @unknown default:
            throw DictationError("Microphone access is off. Turn it on in Settings.")
        }
    }
}
