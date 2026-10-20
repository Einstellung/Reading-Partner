package com.xinyuan.readingpartner.voice

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioRecordingConfiguration
import android.media.AudioTimestamp
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean

// The device side of the call in `:voice` (docs/companion/89, 采集与播放), the
// Android counterpart of AudioFront.swift. Opened on the engine's `open`
// control, everything put back on `close`. The engine reaches it through
// VoiceNative only: the microphone thread pushes buffers, the writer thread
// pulls samples, and [event] reports what the system took away.
//
// One AudioRecord lives as long as the audio is open, recording only while the
// engine wants the microphone: its session is the one the track plays on, so
// the echo canceller has its reference, and the track never has to be rebuilt
// (which would restart its frame count under the engine) when a call starts
// over speech that was already playing.
@SuppressLint("MissingPermission")
class VoiceAudio(context: Context, private val event: (String) -> Unit) {
    private val manager = context.getSystemService(AudioManager::class.java)
    private val callbacks = HandlerThread("voice-audio").apply { start() }
    private val handler = Handler(callbacks.looper)

    private var opened = false
    private var savedMode = AudioManager.MODE_NORMAL
    private var focus: AudioFocusRequest? = null
    private var record: AudioRecord? = null
    private var echo: AcousticEchoCanceler? = null
    private var noise: NoiseSuppressor? = null
    private var track: AudioTrack? = null
    @Volatile private var capturing = false
    private var capture: Thread? = null
    @Volatile private var writing = false
    private var writer: Thread? = null
    /** `silenced` and `input-lost` are said once per open. */
    private val reported = AtomicBoolean(false)

    private val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

    private val devices = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = route()
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = route()
    }

    private val recordings = object : AudioManager.AudioRecordingCallback() {
        override fun onRecordingConfigChanged(configs: List<AudioRecordingConfiguration>) {
            val session = record?.audioSessionId ?: return
            if (capturing && configs.any { it.clientAudioSessionId == session && it.isClientSilenced }) {
                lose("silenced")
            }
        }
    }

    /** Open the player, and the microphone when [withCapture]; again to change that. */
    @Synchronized
    fun open(withCapture: Boolean) {
        if (!opened) {
            opened = true
            reported.set(false)
            savedMode = manager.mode
            manager.mode = AudioManager.MODE_IN_COMMUNICATION
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener({ change ->
                    if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                        event("focus-lost")
                    }
                }, handler)
                .build()
            focus = request
            manager.requestAudioFocus(request)
            manager.registerAudioDeviceCallback(devices, handler)
            manager.registerAudioRecordingCallback(recordings, handler)
            route()
            val rec = AudioRecord(
                MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                MIC_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                maxOf(AudioRecord.getMinBufferSize(MIC_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT), MIC_FRAME * 2 * 4),
            )
            record = rec
            if (AcousticEchoCanceler.isAvailable()) {
                echo = AcousticEchoCanceler.create(rec.audioSessionId)?.also { it.enabled = true }
            }
            if (NoiseSuppressor.isAvailable()) {
                noise = NoiseSuppressor.create(rec.audioSessionId)?.also { it.enabled = true }
            }
            openTrack(rec.audioSessionId)
        }
        if (withCapture && !capturing) startCapture() else if (!withCapture && capturing) stopCapture()
    }

    /** Put back everything [open] changed. */
    @Synchronized
    fun close() {
        if (!opened) return
        opened = false
        stopCapture()
        writing = false
        track?.let {
            try {
                it.pause()
                it.flush()
            } catch (_: IllegalStateException) {
            }
        }
        writer?.join(JOIN_MS)
        writer = null
        track?.release()
        track = null
        echo?.release()
        echo = null
        noise?.release()
        noise = null
        record?.release()
        record = null
        manager.unregisterAudioRecordingCallback(recordings)
        manager.unregisterAudioDeviceCallback(devices)
        focus?.let { manager.abandonAudioFocusRequest(it) }
        focus = null
        manager.clearCommunicationDevice()
        manager.mode = savedMode
    }

    fun setVolume(value: Float) {
        track?.setVolume(value.coerceIn(0f, 1f))
    }

    private fun openTrack(session: Int) {
        val minBytes = AudioTrack.getMinBufferSize(PLAY_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val t = AudioTrack.Builder()
            .setAudioAttributes(attributes)
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(PLAY_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .build()
            )
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setBufferSizeInBytes(maxOf(minBytes * 2, PLAY_RATE / 10 * 2))
            .setSessionId(session)
            .build()
        t.play()
        track = t
        writing = true
        writer = Thread({ writeLoop(t) }, "voice-writer").also { it.start() }
    }

    /**
     * nativeReadPlayback -> write -> nativePlaybackPosition. A -1 is the only
     * flush, and it happens here, before the samples that follow it are
     * written: a flush from another thread could land after them and wipe
     * them out. The track counts frames from zero again after it.
     */
    private fun writeLoop(t: AudioTrack) {
        val buf = ShortArray(WRITE_FRAMES)
        val stamp = AudioTimestamp()
        var written = 0L
        var flushedAt = 0L
        try {
            while (writing) {
                val n = VoiceNative.nativeReadPlayback(buf)
                if (n < 0) {
                    t.pause()
                    t.flush()
                    written = 0
                    flushedAt = System.nanoTime()
                    t.play()
                    continue
                }
                var off = 0
                while (off < n && writing) {
                    val w = t.write(buf, off, n - off, AudioTrack.WRITE_BLOCKING)
                    if (w < 0) break
                    off += w
                }
                written += off
                if (t.getTimestamp(stamp)) {
                    val frames = VoicePolicy.playedFrames(stamp.framePosition, stamp.nanoTime, flushedAt, written)
                    if (frames >= 0) VoiceNative.nativePlaybackPosition(frames, stamp.nanoTime)
                }
            }
        } catch (e: IllegalStateException) {
            // The track was released under a writer that outlived close's join.
            Log.w(TAG, "writer stopped", e)
        }
    }

    private fun startCapture() {
        val rec = record ?: return
        try {
            rec.startRecording()
        } catch (e: IllegalStateException) {
            Log.e(TAG, "startRecording failed", e)
            lose("input-lost")
            return
        }
        capturing = true
        capture = Thread({ captureLoop(rec) }, "voice-mic").also { it.start() }
    }

    private fun stopCapture() {
        if (!capturing) return
        capturing = false
        try {
            record?.stop()
        } catch (_: IllegalStateException) {
        }
        capture?.join(JOIN_MS)
        capture = null
    }

    /** 512 samples at 16 kHz: one Silero frame per read. */
    private fun captureLoop(rec: AudioRecord) {
        val buf = ShortArray(MIC_FRAME)
        while (capturing) {
            val n = rec.read(buf, 0, MIC_FRAME, AudioRecord.READ_BLOCKING)
            if (n > 0) {
                VoiceNative.nativeCapture(buf, n, System.nanoTime())
            } else if (n < 0) {
                if (capturing) lose("input-lost")
                return
            }
        }
    }

    /** Pick the communication device again: on open and whenever devices come or go. */
    @Synchronized
    private fun route() {
        if (!opened) return
        val available = manager.availableCommunicationDevices
        val i = VoicePolicy.pickDevice(available.map { it.type })
        if (i >= 0) {
            manager.setCommunicationDevice(available[i])
        }
        if (i < 0 || (capturing && manager.getDevices(AudioManager.GET_DEVICES_INPUTS).isEmpty())) {
            lose("input-lost")
        }
    }

    /** Not under the lock: the microphone thread calls it while close may be joining it. */
    private fun lose(kind: String) {
        if (reported.compareAndSet(false, true)) event(kind)
    }

    companion object {
        private const val TAG = "VoiceAudio"
        const val MIC_RATE = 16_000
        const val MIC_FRAME = 512
        /** Kokoro's own rate. */
        const val PLAY_RATE = 24_000
        /** 20 ms: the longest a stale write can hold off a flush. */
        const val WRITE_FRAMES = 480
        private const val JOIN_MS = 500L
    }
}
