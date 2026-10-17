//! Text frontend for Kokoro-82M-v1.1-zh: text to the phoneme strings Python `KPipeline` feeds the model,
//! matching misaki 0.9.4 (`misaki[zh]` with `ZHG2P(version="1.1")`, `misaki[en]` us_gold/us_silver without
//! the espeak fallback). Independent of the inference code: the output is plain misaki-vocabulary text.
//!
//! The tables (jieba, pypinyin, misaki lexicons) are exported by `tools/kokoro_g2p/export_data.py`,
//! Brotli-compressed into `data/`, and decoded on first use (`preload` does it ahead of time).

mod cn2an;
mod en;
mod jieba;
mod lists;
mod pinyin;
mod util;
mod zh;

#[cfg(test)]
mod gold_tests;

use std::io::Read;
use std::sync::OnceLock;

use util::{py_strip, Reader};

static ZH_DATA: &[u8] = include_bytes!("data/zh.bin.br");
static EN_DATA: &[u8] = include_bytes!("data/en.bin.br");

/// Python KPipeline caps one chunk's phonemes at this length (the model's context minus the pad tokens).
pub const MAX_PHONEMES: usize = 510;

fn unpack(b: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    brotli_decompressor::Decompressor::new(b, 1 << 16)
        .read_to_end(&mut out)
        .expect("kokoro_g2p: corrupt embedded table");
    out
}

fn english() -> &'static en::En {
    static EN: OnceLock<en::En> = OnceLock::new();
    EN.get_or_init(|| {
        let b = unpack(EN_DATA);
        let mut r = Reader::new(&b);
        r.magic(b"KEN1");
        en::En::load(&mut r)
    })
}

fn chinese() -> &'static zh::Zh {
    static ZH: OnceLock<zh::Zh> = OnceLock::new();
    ZH.get_or_init(|| {
        let b = unpack(ZH_DATA);
        let mut r = Reader::new(&b);
        r.magic(b"KZH1");
        let jieba = jieba::Jieba::load(&mut r);
        let py = pinyin::Pinyin::load(&mut r);
        zh::Zh::new(jieba, py)
    })
}

/// Decode both tables now instead of on the first sentence.
pub fn preload() {
    english();
    chinese();
}

/// `KPipeline(lang_code='a')`: one phoneme string per chunk the pipeline would synthesise.
pub fn phonemize_en(text: &str) -> Vec<String> {
    english().pipeline(text)
}

/// The English callable ZHG2P uses for Latin runs inside Chinese text: the first chunk of the English pipeline.
fn en_callable(text: &str) -> String {
    phonemize_en(text).into_iter().next().unwrap_or_default()
}

/// Python `re.split(r'([.!?]+)', s)` without the empty trailing piece semantics changing anything here.
fn split_sentences(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if matches!(c, '.' | '!' | '?') {
            out.push(std::mem::take(&mut cur));
            let mut p = c.to_string();
            while let Some(&n) = chars.peek() {
                if matches!(n, '.' | '!' | '?') {
                    p.push(n);
                    chars.next();
                } else {
                    break;
                }
            }
            out.push(p);
        } else {
            cur.push(c);
        }
    }
    out.push(cur);
    out
}

/// `KPipeline(lang_code='z', repo_id='hexgrad/Kokoro-82M-v1.1-zh')`: one phoneme string per chunk.
pub fn phonemize_zh(text: &str) -> Vec<String> {
    let zh = chinese();
    let mut out = Vec::new();
    for line in text.split('\n').filter(|l| !l.is_empty()) {
        let pieces = split_sentences(line);
        let mut chunks: Vec<String> = Vec::new();
        let mut cur = String::new();
        let mut i = 0;
        while i < pieces.len() {
            let mut sentence = pieces[i].clone();
            if i + 1 < pieces.len() {
                sentence.push_str(&pieces[i + 1]);
            }
            if cur.chars().count() + sentence.chars().count() <= 400 {
                cur.push_str(&sentence);
            } else {
                if !cur.is_empty() {
                    chunks.push(py_strip(&cur).to_string());
                }
                cur = sentence;
            }
            i += 2;
        }
        if !cur.is_empty() {
            chunks.push(py_strip(&cur).to_string());
        }
        if chunks.is_empty() {
            chunks.push(line.to_string());
        }
        for chunk in chunks {
            if py_strip(&chunk).is_empty() {
                continue;
            }
            let ps = zh.g2p(&chunk, &en_callable);
            if ps.is_empty() {
                continue;
            }
            out.push(ps.chars().take(MAX_PHONEMES).collect());
        }
    }
    out
}
