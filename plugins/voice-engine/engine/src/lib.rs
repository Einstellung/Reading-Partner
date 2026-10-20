// The Android voice engine (docs/companion/89): the library VoiceService loads
// in the `:voice` process. ONNX Runtime (Silero, Smart Turn, Kokoro) and
// llama.cpp (Qwen3-ASR) live here and nowhere in the main process.
//
// For now it only brings both runtimes up, which proves they link into one
// shared object for aarch64-linux-android.

pub mod asr;
pub mod call;
pub mod host;
pub mod mel;
pub mod playback;
pub mod serve;
pub mod smart_turn;
pub mod turn;
pub mod vad;
pub mod virtual_device;

use llama_cpp_2::llama_backend::LlamaBackend;

#[cfg(test)]
mod fixture;
#[cfg(test)]
mod scenarios;

/// Create the ONNX Runtime environment and initialise the llama.cpp backend.
/// The backend must outlive every llama.cpp model and context.
pub fn init_runtimes() -> Result<LlamaBackend, String> {
    let _ = ort::init().with_name("voice-engine").commit();
    ort::environment::Environment::current().map_err(|e| format!("ONNX Runtime: {e}"))?;
    LlamaBackend::init().map_err(|e| format!("llama.cpp: {e}"))
}

/// C entry point that keeps both runtimes in the shared object past
/// `--gc-sections` until the JNI surface exists. 0 on success.
#[no_mangle]
pub extern "C" fn voice_engine_probe() -> i32 {
    match init_runtimes() {
        Ok(_backend) => 0,
        Err(_) => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_runtimes_come_up() {
        init_runtimes().expect("runtimes");
    }
}
