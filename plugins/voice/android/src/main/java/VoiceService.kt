package com.xinyuan.readingpartner.voice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.ParcelFileDescriptor
import android.os.RemoteException
import android.util.Log
import org.json.JSONObject

// The `:voice` process's service (docs/companion/89): the only place
// libvoice_engine.so is loaded. It takes the socket VoicePlugin hands it,
// gives it to the engine, and runs VoiceAudio on the engine's controls. No
// Tauri class is referenced: there is no Tauri in this process.
class VoiceService : Service() {
    private var available = false
    private var audio: VoiceAudio? = null
    private var controls: Thread? = null
    private var foreground = false

    private val messenger = Messenger(Handler(Looper.getMainLooper()) { msg -> handle(msg); true })

    override fun onCreate() {
        super.onCreate()
        available = try {
            System.loadLibrary(VoicePolicy.LIBRARY)
            true
        } catch (e: UnsatisfiedLinkError) {
            Log.e(TAG, "libvoice_engine.so did not load", e)
            false
        }
        if (available) {
            audio = VoiceAudio(this) { kind -> VoiceNative.nativeAudioEvent(kind) }
            controls = Thread({ controlLoop() }, "voice-control").also { it.start() }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // First: startForegroundService gave us a few seconds to do this, and
        // wants it again on every start.
        enterForeground(force = true)
        if (!available) {
            leaveForeground()
            stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent): IBinder = messenger.binder

    override fun onDestroy() {
        audio?.close()
        super.onDestroy()
    }

    private fun handle(msg: Message) {
        when (msg.what) {
            MSG_ATTACH -> {
                @Suppress("DEPRECATION")
                val pfd = msg.data?.getParcelable<ParcelFileDescriptor>(KEY_FD)
                val result = when {
                    !available -> {
                        pfd?.close()
                        stopSelf()
                        UNAVAILABLE
                    }
                    pfd == null -> FAILED
                    VoiceNative.nativeAttach(pfd.detachFd()) -> ATTACHED
                    else -> FAILED
                }
                try {
                    msg.replyTo?.send(Message.obtain(null, MSG_ATTACHED, msg.arg1, result))
                } catch (_: RemoteException) {
                }
            }
            MSG_APP_STOPPED -> if (available) VoiceNative.nativeAudioEvent("app-stopped")
        }
    }

    /** The engine's controls, in order, until it exits. */
    private fun controlLoop() {
        val audio = audio ?: return
        while (true) {
            val json = VoiceNative.nativeNextControl() ?: break
            try {
                val control = JSONObject(json)
                when (control.optString("kind")) {
                    "open" -> {
                        enterForeground()
                        audio.open(control.optBoolean("capture"))
                    }
                    "close" -> {
                        audio.close()
                        leaveForeground()
                    }
                    "volume" -> audio.setVolume(control.optDouble("value", 1.0).toFloat())
                    "exit" -> break
                }
            } catch (e: Exception) {
                Log.e(TAG, "control $json failed", e)
            }
        }
        audio.close()
    }

    /** The microphone type needs RECORD_AUDIO, which openEngine made sure of. */
    @Synchronized
    private fun enterForeground(force: Boolean = false) {
        if (foreground && !force) return
        try {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, "Voice call", NotificationManager.IMPORTANCE_LOW)
            )
            val notification = Notification.Builder(this, CHANNEL)
                .setSmallIcon(applicationInfo.icon)
                .setContentTitle("Voice call")
                .setOngoing(true)
                .build()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            foreground = true
        } catch (e: Exception) {
            // Not allowed from the background: the microphone is then silenced
            // and VoiceAudio reports it.
            Log.e(TAG, "startForeground failed", e)
        }
    }

    @Synchronized
    private fun leaveForeground() {
        if (!foreground) return
        stopForeground(STOP_FOREGROUND_REMOVE)
        foreground = false
    }

    companion object {
        private const val TAG = "VoiceService"
        private const val CHANNEL = "voice-call"
        private const val NOTIFICATION_ID = 7301

        const val MSG_ATTACH = 1
        const val MSG_ATTACHED = 2
        const val MSG_APP_STOPPED = 3
        const val KEY_FD = "fd"

        /** MSG_ATTACHED's arg2. */
        const val ATTACHED = 1
        const val FAILED = 0
        const val UNAVAILABLE = 2
    }
}
