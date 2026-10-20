package com.xinyuan.readingpartner.voice

import android.Manifest
import android.app.Activity
import android.app.ActivityManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.ParcelFileDescriptor
import android.os.RemoteException
import app.tauri.Logger
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import dalvik.system.BaseDexClassLoader

// The main process's half (docs/companion/89, 主进程和引擎之间): whether this
// device can hold a call, where the models live, and the socket to `:voice`.
// Rust (plugins/voice/src/android.rs) calls the three commands; after
// openEngine it talks to the engine on the socket and Kotlin is out of it.
// Commands run on the UI thread, which also delivers the binding's callbacks,
// so openEngine answers from those callbacks rather than waiting.
@TauriPlugin(
    permissions = [Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")]
)
class VoicePlugin(private val activity: Activity) : Plugin(activity) {
    private val context: Context = activity.applicationContext
    /** Hardware constants, so worked out once when the plugin loads; false for good once `:voice` could not load the library. */
    @Volatile private var capable = try {
        computeCapability()
    } catch (e: Exception) {
        Logger.error("voice: capability check failed: $e")
        false
    }

    private var service: Messenger? = null
    private var binding = false
    /** openEngine calls waiting for the service to connect. */
    private val connecting = mutableListOf<Invoke>()
    /** Attaches sent to the service, by request id: the call and this process's end of the pair. */
    private val attaching = mutableMapOf<Int, Pair<Invoke, ParcelFileDescriptor>>()
    private var nextRequest = 1

    private val replies = Messenger(Handler(Looper.getMainLooper()) { msg -> reply(msg); true })

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            service = Messenger(binder)
            val waiting = connecting.toList()
            connecting.clear()
            waiting.forEach { attach(it) }
        }

        override fun onServiceDisconnected(name: ComponentName) {
            // `:voice` died; the binding brings it back on its own.
            service = null
            failAttaching(EXITED)
        }

        override fun onBindingDied(name: ComponentName) {
            service = null
            binding = false
            try {
                context.unbindService(this)
            } catch (_: IllegalArgumentException) {
            }
            failAttaching(EXITED)
            connecting.toList().also { connecting.clear() }.forEach { it.reject(EXITED) }
        }
    }

    private fun computeCapability(): Boolean {
        val sdk = Build.VERSION.SDK_INT
        val hasLibrary = (javaClass.classLoader as? BaseDexClassLoader)?.findLibrary(VoicePolicy.LIBRARY) != null
        val info = ActivityManager.MemoryInfo()
        (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(info)
        val advertised = if (sdk >= VoicePolicy.ADVERTISED_MEM_SDK) info.advertisedMem else 0L
        return VoicePolicy.callCapable(sdk, hasLibrary, advertised, info.totalMem)
    }

    @Command
    fun capability(invoke: Invoke) {
        invoke.resolve(JSObject().put("call", capable))
    }

    @Command
    fun noBackupDir(invoke: Invoke) {
        invoke.resolve(JSObject().put("path", context.noBackupFilesDir.absolutePath))
    }

    @Command
    fun openEngine(invoke: Invoke) {
        if (!capable) {
            invoke.reject(NO_ENGINE)
            return
        }
        if (getPermissionState(MICROPHONE) != PermissionState.GRANTED) {
            requestPermissionForAlias(MICROPHONE, invoke, "microphonePermission")
            return
        }
        connect(invoke)
    }

    @PermissionCallback
    private fun microphonePermission(invoke: Invoke) {
        if (getPermissionState(MICROPHONE) == PermissionState.GRANTED) {
            connect(invoke)
        } else {
            invoke.reject(NO_MICROPHONE)
        }
    }

    /** Start `:voice` in the foreground (while the activity is visible) and bind it. */
    private fun connect(invoke: Invoke) {
        val intent = Intent(context, VoiceService::class.java)
        try {
            context.startForegroundService(intent)
        } catch (e: Exception) {
            invoke.reject("$NO_ENGINE ($e)")
            return
        }
        if (service != null) {
            attach(invoke)
            return
        }
        connecting.add(invoke)
        if (!binding) {
            binding = context.bindService(intent, connection, Context.BIND_AUTO_CREATE)
            if (!binding) {
                connecting.toList().also { connecting.clear() }.forEach { it.reject(NO_ENGINE) }
            }
        }
    }

    /** Hand one end of a fresh socket pair to `:voice`; the other goes to Rust once it is served. */
    private fun attach(invoke: Invoke) {
        val messenger = service ?: return connect(invoke)
        val pair = try {
            ParcelFileDescriptor.createSocketPair()
        } catch (e: Exception) {
            invoke.reject("$NO_ENGINE ($e)")
            return
        }
        val id = nextRequest++
        val msg = Message.obtain(null, VoiceService.MSG_ATTACH, id, 0)
        msg.data = Bundle().apply { putParcelable(VoiceService.KEY_FD, pair[1]) }
        msg.replyTo = replies
        attaching[id] = invoke to pair[0]
        try {
            messenger.send(msg)
        } catch (e: RemoteException) {
            attaching.remove(id)
            pair[0].close()
            invoke.reject(EXITED)
        } finally {
            // The binder duplicated it into the message.
            pair[1].close()
        }
    }

    private fun reply(msg: Message) {
        if (msg.what != VoiceService.MSG_ATTACHED) return
        val (invoke, mine) = attaching.remove(msg.arg1) ?: return
        when (msg.arg2) {
            VoiceService.ATTACHED -> invoke.resolve(JSObject().put("fd", mine.detachFd()))
            VoiceService.UNAVAILABLE -> {
                capable = false
                mine.close()
                invoke.reject(NO_ENGINE)
            }
            else -> {
                mine.close()
                invoke.reject(NO_ENGINE)
            }
        }
    }

    private fun failAttaching(message: String) {
        val failed = attaching.values.toList()
        attaching.clear()
        failed.forEach { (invoke, mine) ->
            mine.close()
            invoke.reject(message)
        }
    }

    /** Leaving the foreground ends a call, as iOS's didEnterBackground does. */
    override fun onStop() {
        val messenger = service ?: return
        try {
            messenger.send(Message.obtain(null, VoiceService.MSG_APP_STOPPED))
        } catch (_: RemoteException) {
        }
    }

    companion object {
        private const val MICROPHONE = "microphone"
        // The same sentences as android.rs and iOS's Recogniser.
        private const val NO_ENGINE = "The voice call is not available on this device."
        private const val NO_MICROPHONE = "Microphone access is off. Turn it on in Settings."
        private const val EXITED = "The voice process exited."
    }
}
