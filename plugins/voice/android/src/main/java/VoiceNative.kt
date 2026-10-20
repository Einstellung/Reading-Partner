package com.xinyuan.readingpartner.voice

// libvoice_engine.so's JNI surface (plugins/voice-engine/engine/src/jni.rs).
// Only `:voice` touches it, and only after VoiceService loaded the library.
// Calls go one way: the engine never calls back into the JVM.
object VoiceNative {
    /** Serve the main process on [fd], which the engine takes over. */
    @JvmStatic external fun nativeAttach(fd: Int): Boolean

    /** Block until the next control, as JSON; null once the engine exits. */
    @JvmStatic external fun nativeNextControl(): String?

    /** [n] samples of 16 kHz mono; the last was captured at [timeNs]. */
    @JvmStatic external fun nativeCapture(buf: ShortArray, n: Int, timeNs: Long)

    /** Up to buf.size 24 kHz samples, waiting at most 20 ms. 0: none yet; -1: flush the track. */
    @JvmStatic external fun nativeReadPlayback(buf: ShortArray): Int

    /** [frames] played since the last flush or the track's creation, at [timeNs]. */
    @JvmStatic external fun nativePlaybackPosition(frames: Long, timeNs: Long)

    /** `focus-lost`, `silenced`, `input-lost` or `app-stopped`. */
    @JvmStatic external fun nativeAudioEvent(kind: String)
}
