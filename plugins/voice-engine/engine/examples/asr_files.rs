// Recognise WAV files one by one with asr.rs and print one line of text per
// file, for scoring against a reference. Timings and the peak RSS go to stderr.
//
//   cargo run --release --example asr_files -- MODEL.gguf MMPROJ.gguf a.wav b.wav ...
//
// The WAVs must be 16 kHz mono 16-bit.

use std::path::Path;
use std::time::Instant;

use voice_engine::asr::Asr;

fn read_wav(p: &Path) -> Vec<f32> {
    let b = std::fs::read(p).unwrap_or_else(|e| panic!("{}: {e}", p.display()));
    let mut i = 12;
    while i + 8 <= b.len() {
        let len = u32::from_le_bytes(b[i + 4..i + 8].try_into().unwrap()) as usize;
        if &b[i..i + 4] == b"data" {
            let data = &b[i + 8..(i + 8 + len).min(b.len())];
            return data.chunks_exact(2).map(|s| i16::from_le_bytes([s[0], s[1]]) as f32 / 32768.0).collect();
        }
        i += 8 + len + (len & 1);
    }
    panic!("{}: no data chunk", p.display());
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    assert!(args.len() >= 3, "usage: asr_files MODEL MMPROJ WAV...");
    let threads = std::env::var("ASR_THREADS").ok().and_then(|t| t.parse().ok()).unwrap_or(4);
    let t = Instant::now();
    let mut asr = Asr::load(Path::new(&args[0]), Path::new(&args[1]), threads).unwrap_or_else(|e| panic!("{e}"));
    eprintln!("load {:.2} s", t.elapsed().as_secs_f64());
    let (mut audio_s, mut busy_s) = (0.0, 0.0);
    for wav in &args[2..] {
        let pcm = read_wav(Path::new(wav));
        let t = Instant::now();
        let text = asr.transcribe(&pcm).unwrap_or_else(|e| panic!("{wav}: {e}"));
        let dt = t.elapsed().as_secs_f64();
        audio_s += pcm.len() as f64 / 16_000.0;
        busy_s += dt;
        eprintln!("{wav}: {:.1} s audio in {dt:.2} s", pcm.len() as f64 / 16_000.0);
        println!("{text}");
    }
    eprintln!("RTF {:.3}", busy_s / audio_s);
    if let Ok(status) = std::fs::read_to_string("/proc/self/status") {
        for line in status.lines().filter(|l| l.starts_with("VmHWM") || l.starts_with("VmRSS")) {
            eprintln!("{line}");
        }
    }
}
