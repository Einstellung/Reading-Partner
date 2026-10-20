// The JNI surface `:voice` loads (docs/companion/89, 主进程和引擎之间): the six
// `VoiceNative` methods Kotlin calls, over one engine for the life of the
// process. Calls only go Kotlin -> Rust; Rust never calls back into the JVM.
// What the engine wants of the device queues up in a ControlQueue, which
// Kotlin's control thread drains through `nativeNextControl`.

use std::os::fd::FromRawFd;
use std::os::unix::net::UnixStream;
use std::sync::{Arc, OnceLock};

use ::jni::objects::{JClass, JShortArray, JString};
use ::jni::sys::{jboolean, jint, jlong, jshort, jstring, JNI_FALSE, JNI_TRUE};
use ::jni::JNIEnv;

use crate::host::{ControlQueue, MonotonicClock, PLAYBACK_WAIT};
use crate::serve::Server;

struct Device {
    server: Arc<Server>,
    controls: Arc<ControlQueue>,
}

static DEVICE: OnceLock<Device> = OnceLock::new();

fn device() -> &'static Device {
    DEVICE.get_or_init(|| {
        let controls = Arc::new(ControlQueue::new());
        let server = Server::on_device(controls.clone(), Arc::new(MonotonicClock));
        // SpeechOut's clock timer: steps the machine when the microphone is quiet.
        server.engine().start_ticker();
        Device { server, controls }
    })
}

/// Serve the main process on `fd`, which this call takes over.
#[no_mangle]
pub extern "system" fn Java_com_xinyuan_readingpartner_voice_VoiceNative_nativeAttach(
    _env: JNIEnv,
    _class: JClass,
    fd: jint,
) -> jboolean {
    if fd < 0 {
        return JNI_FALSE;
    }
    // SAFETY: Kotlin detached the descriptor and hands it over.
    let stream = unsafe { UnixStream::from_raw_fd(fd) };
    match device().server.attach_stream(stream) {
        Ok(_) => JNI_TRUE,
        Err(_) => JNI_FALSE,
    }
}

/// Block until the next control for the device, as JSON; null after `exit`.
#[no_mangle]
pub extern "system" fn Java_com_xinyuan_readingpartner_voice_VoiceNative_nativeNextControl(
    env: JNIEnv,
    _class: JClass,
) -> jstring {
    match device().controls.next_json() {
        Some(json) => env.new_string(json).map(|s| s.into_raw()).unwrap_or(std::ptr::null_mut()),
        None => std::ptr::null_mut(),
    }
}

/// `n` microphone samples, 16 kHz mono; the last was captured at `time_ns`.
#[no_mangle]
pub extern "system" fn Java_com_xinyuan_readingpartner_voice_VoiceNative_nativeCapture(
    env: JNIEnv,
    _class: JClass,
    buf: JShortArray,
    n: jint,
    time_ns: jlong,
) {
    let Ok(len) = env.get_array_length(&buf) else { return };
    let n = n.clamp(0, len) as usize;
    let mut pcm: Vec<jshort> = vec![0; n];
    if env.get_short_array_region(&buf, 0, &mut pcm).is_ok() {
        device().server.engine().capture(&pcm, time_ns);
    }
}

/// Up to `buf.size` samples for the track, waiting at most 20 ms. 0: none yet.
/// -1: `pause()` + `flush()` the track before writing anything else.
#[no_mangle]
pub extern "system" fn Java_com_xinyuan_readingpartner_voice_VoiceNative_nativeReadPlayback(
    env: JNIEnv,
    _class: JClass,
    buf: JShortArray,
) -> jint {
    let Ok(len) = env.get_array_length(&buf) else { return 0 };
    let mut pcm: Vec<jshort> = vec![0; len.max(0) as usize];
    let n = device().server.engine().read_playback(&mut pcm, PLAYBACK_WAIT);
    if n > 0 && env.set_short_array_region(&buf, 0, &pcm[..n as usize]).is_err() {
        return 0;
    }
    n
}

/// AudioTrack.getTimestamp: `frames` since the last flush, heard at `time_ns`.
#[no_mangle]
pub extern "system" fn Java_com_xinyuan_readingpartner_voice_VoiceNative_nativePlaybackPosition(
    _env: JNIEnv,
    _class: JClass,
    frames: jlong,
    time_ns: jlong,
) {
    device().server.engine().playback_position(frames, time_ns);
}

/// `focus-lost`, `silenced`, `input-lost` or `app-stopped`.
#[no_mangle]
pub extern "system" fn Java_com_xinyuan_readingpartner_voice_VoiceNative_nativeAudioEvent(
    mut env: JNIEnv,
    _class: JClass,
    kind: JString,
) {
    let Ok(kind) = env.get_string(&kind) else { return };
    let kind: String = kind.into();
    device().server.engine().audio_event(&kind);
}
