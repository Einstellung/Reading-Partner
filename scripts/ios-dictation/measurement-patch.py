#!/usr/bin/env python3
"""Turn the Mac's checkout into a measurement build, and back again.

Two edits that must never be committed, applied the same way the .dev bundle id
is: in the working tree of the Mac's clone only, reverted when the run is done.

  1. backstopSeconds 300 -> 1500. Hold-to-talk tears a run down after five
     minutes on purpose; the twenty-minute question belongs to rehearsal, not to
     dictation, and the shipping default has to stay 300.
  2. A telemetry line every 30 seconds carrying resident memory, thermal state,
     the number of settled stretches and the accumulator's size. Resident memory
     and thermal state are only readable from inside the process, and a shipping
     build has no business sampling either.

Usage:  measurement-patch.py apply|revert [repo]
Verify: `git status --short` in the Mac clone should show exactly
        src-tauri/tauri.conf.json (the .dev id) once this has been reverted.
"""
import sys
import pathlib

REPO = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "/Users/mima1234/Reading-Partner")
SWIFT = REPO / "plugins/voice/ios/Sources/DictationRun.swift"

BACKSTOP_OFF = "    private static let backstopSeconds: UInt64 = 300"
BACKSTOP_ON = "    private static let backstopSeconds: UInt64 = 1500  // MEASUREMENT BUILD"

ANCHOR = """    private func startBackstop() {"""

TELEMETRY = """    // MEASUREMENT BUILD ONLY — never commit. Resident memory and thermal state
    // can only be read from inside the process, and a shipping build has no
    // reason to sample either.
    private var telemetryTask: Task<Void, Never>?

    private static func residentBytes() -> UInt64 {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(
            MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }
        return result == KERN_SUCCESS ? info.resident_size : 0
    }

    private func startTelemetry() {
        telemetryTask = Task { [weak self] in
            var tick = 0
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                if Task.isCancelled { return }
                guard let self = self else { return }
                tick += 1
                self.transcriptLock.lock()
                let count = self.finals.count
                let chars = self.finals.reduce(0) { $0 + $1.count } + self.volatileTail.count
                self.transcriptLock.unlock()
                NSLog(
                    "RP-DICT telemetry t=%ds rssMB=%.1f thermal=%d finals=%d accumChars=%d",
                    tick * 30,
                    Double(Self.residentBytes()) / 1_048_576.0,
                    ProcessInfo.processInfo.thermalState.rawValue,
                    count,
                    chars)
            }
        }
    }

    private func startBackstop() {
        startTelemetry()"""

TELEMETRY_CANCEL_OFF = """        backstopTask?.cancel()
        backstopTask = nil
"""
TELEMETRY_CANCEL_ON = """        backstopTask?.cancel()
        backstopTask = nil
        telemetryTask?.cancel()
        telemetryTask = nil
"""


def apply() -> None:
    s = SWIFT.read_text()
    if "MEASUREMENT BUILD" in s:
        print("already applied")
        return
    assert BACKSTOP_OFF in s, "backstop constant not found"
    assert ANCHOR in s, "startBackstop not found"
    assert TELEMETRY_CANCEL_OFF in s, "backstop cancel not found"
    s = s.replace(BACKSTOP_OFF, BACKSTOP_ON, 1)
    s = s.replace(ANCHOR, TELEMETRY, 1)
    s = s.replace(TELEMETRY_CANCEL_OFF, TELEMETRY_CANCEL_ON, 1)
    SWIFT.write_text(s)
    print("applied: backstop 1500s + 30s telemetry")


def revert() -> None:
    s = SWIFT.read_text()
    if "MEASUREMENT BUILD" not in s:
        print("already clean")
        return
    s = s.replace(BACKSTOP_ON, BACKSTOP_OFF, 1)
    s = s.replace(TELEMETRY, ANCHOR, 1)
    s = s.replace(TELEMETRY_CANCEL_ON, TELEMETRY_CANCEL_OFF, 1)
    SWIFT.write_text(s)
    print("reverted")


if __name__ == "__main__":
    {"apply": apply, "revert": revert}[sys.argv[1]]()
