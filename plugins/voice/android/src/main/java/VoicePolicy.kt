package com.xinyuan.readingpartner.voice

import android.media.AudioDeviceInfo

// The decisions that need no device (docs/companion/89, 内存门槛 and 采集与播放),
// kept free of Android calls so the unit tests run on the JVM. The
// AudioDeviceInfo constants are compile-time ints and are inlined.
object VoicePolicy {
    /** libvoice_engine.so, arm64-v8a only. */
    const val LIBRARY: String = "voice_engine"

    /** 6 GB phones fall short of this on both readings; 8 GB ones clear it. */
    const val MEMORY_FLOOR: Long = 6_800_000_000L

    /** API 31: setCommunicationDevice and the rest of VoiceAudio. */
    const val MIN_SDK: Int = 31

    /** API 34: ActivityManager.MemoryInfo.advertisedMem. */
    const val ADVERTISED_MEM_SDK: Int = 34

    /**
     * Whether this device can hold a call. [advertisedMem] is read on API 34+
     * (the memory on the box), [totalMem] below (what the kernel sees, which is
     * a little less).
     */
    fun callCapable(sdk: Int, hasLibrary: Boolean, advertisedMem: Long, totalMem: Long): Boolean {
        if (sdk < MIN_SDK || !hasLibrary) return false
        val memory = if (sdk >= ADVERTISED_MEM_SDK) advertisedMem else totalMem
        return memory >= MEMORY_FLOOR
    }

    /** Most wanted first; the earpiece never, as iOS's `.defaultToSpeaker`. */
    val DEVICE_PRIORITY: List<Int> = listOf(
        AudioDeviceInfo.TYPE_BLE_HEADSET,
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        AudioDeviceInfo.TYPE_USB_HEADSET,
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
    )

    /**
     * The index in [types] (getAvailableCommunicationDevices' order) of the
     * device to route the call to, or -1 when none of them will do.
     */
    fun pickDevice(types: List<Int>): Int {
        for (wanted in DEVICE_PRIORITY) {
            val i = types.indexOf(wanted)
            if (i >= 0) return i
        }
        return -1
    }

    /**
     * What nativePlaybackPosition gets from an AudioTimestamp: frames since
     * the last flush (the track's counter starts again at zero there), or -1
     * for a stamp taken before that flush. Never more than was written.
     */
    fun playedFrames(framePosition: Long, stampNs: Long, flushedAtNs: Long, written: Long): Long {
        if (stampNs < flushedAtNs) return -1
        return framePosition.coerceIn(0, written)
    }
}
