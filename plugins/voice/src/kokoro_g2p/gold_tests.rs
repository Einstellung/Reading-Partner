//! Sentence-by-sentence comparison with Python misaki 0.9.4 (testdata/gold.json, written by
//! tools/kokoro_g2p/make_gold.py from tools/kokoro_g2p/corpus.txt).

use super::{phonemize_en, phonemize_zh};

#[derive(serde::Deserialize)]
struct Gold {
    lang: String,
    text: String,
    phonemes: Vec<String>,
}

fn run(text: &str, lang: &str) -> Vec<String> {
    if lang == "a" {
        phonemize_en(text)
    } else {
        phonemize_zh(text)
    }
}

/// Sentences where this port knowingly differs from misaki, with the reason. Every other sentence must match.
/// All five come from the held-out English sentences and from the same place: spaCy's statistical tagger is
/// replaced by rules (en.rs `tag_word`), and the tag picks the reading of a heteronym or of "that".
const KNOWN_DIFFS: &[(&str, &str)] = &[
    ("The record shows that prices rose by 4.5 percent last year.", "spaCy tags that IN (unstressed), ours DT"),
    ("He lives close to the station, so he walks to work.", "spaCy tags close RB/JJ (klˈOs), ours VBP (klˈOz)"),
    ("The pipes were made of lead in the old house.", "spaCy tags old JJ, ours NN, so house reads as a verb (hˈWz)"),
    ("What does the author mean by the word progress?", "spaCy tags progress NN (pɹˈɑɡɹəs), ours VBP"),
    ("My phone number used to be different.", "spaCy tags used VBN (jˈuzd), ours VBD, which misaki reads jˈust before to"),
];

/// Deliberate corrections of misaki's own errors: (text, our phonemes). These are excluded from the match rate.
const CORRECTIONS: &[(&str, &str)] = &[
    // misaki: 闪闪发光 shan3 shan5. Idioms keep the full tone, so third-tone sandhi gives shan2 shan3.
    (
        "哈利·波特第一次走进对角巷的时候，整条街都在冒着热气，他简直看呆了。猫头鹰在笼子里扑腾，店门口挂着闪闪发光的坩埚。",
        "ㄏㄚ1ㄌㄧ4❓ㄅㄛ1ㄊㄜ4/ㄉㄧ4ㄧ1ㄘㄭ4/ㄗㄡ3ㄐ阴4/ㄉ为4ㄐ要3/ㄒ阳4/ㄉㄜ5/ㄕ十2ㄏㄡ5, ㄓㄥ3ㄊ要2/ㄐㄝ1/ㄉㄡ1/ㄗㄞ4/ㄇㄠ4/ㄓㄜ5/ㄖㄜ4ㄑㄧ4, ㄊㄚ1/ㄐ言3ㄓ十2/ㄎㄢ4/ㄉㄞ1/ㄌㄜ5. ㄇㄠ1ㄊㄡ2应1/ㄗㄞ4/ㄌ中2ㄗㄭ5/ㄌㄧ3/ㄆㄨ1ㄊㄥ5, ㄉ言4ㄇㄣ2ㄎㄡ3/ㄍ穵4/ㄓㄜ5/ㄕㄢ2ㄕㄢ3ㄈㄚ1ㄍ王1/ㄉㄜ5/ㄍㄢ1ㄍ我1.",
    ),
    // misaki: 沙沙作响 sha1 sha5.
    ("窗外的树叶被风吹得沙沙作响。", "ㄔ王1外4/ㄉㄜ5/ㄕㄨ4ㄝ4/ㄅㄟ4/ㄈㄥ1ㄔ为1/ㄉㄜ5/ㄕㄚ1ㄕㄚ1ㄗ我4ㄒ阳3."),
];

#[test]
fn matches_misaki_gold() {
    let gold: Vec<Gold> = serde_json::from_str(include_str!("testdata/gold.json")).unwrap();
    let mut ok = 0;
    let mut bad = Vec::new();
    let mut unexpected = Vec::new();
    for g in &gold {
        let got = run(&g.text, &g.lang);
        if let Some((_, want)) = CORRECTIONS.iter().find(|c| c.0 == g.text) {
            assert_eq!(got.join("\n"), *want, "correction drifted: {}", g.text);
            continue;
        }
        if got == g.phonemes {
            ok += 1;
            continue;
        }
        bad.push(g.text.clone());
        if !KNOWN_DIFFS.iter().any(|d| d.0 == g.text) {
            unexpected.push(format!("[{}] {}\n  misaki: {:?}\n  ours:   {:?}", g.lang, g.text, g.phonemes, got));
        }
    }
    let total = gold.len() - CORRECTIONS.len();
    eprintln!(
        "kokoro_g2p gold: {ok}/{total} identical ({:.1}%), {} deliberate corrections excluded",
        100.0 * ok as f64 / total as f64,
        CORRECTIONS.len()
    );
    for d in KNOWN_DIFFS {
        assert!(bad.iter().any(|b| b == d.0), "known diff now matches, drop it from KNOWN_DIFFS: {}", d.0);
    }
    assert!(unexpected.is_empty(), "{} unexpected mismatches:\n{}", unexpected.len(), unexpected.join("\n"));
}

#[test]
fn timing_30_chars() {
    let s = "今天下午三点我们在学校图书馆讨论人工智能的发展历史和未来趋势";
    assert_eq!(s.chars().count(), 30);
    let t = std::time::Instant::now();
    super::preload();
    eprintln!("kokoro_g2p: table load {:.0} ms (shared with other tests in this run)", t.elapsed().as_secs_f64() * 1000.0);
    let n = 200;
    let t = std::time::Instant::now();
    for _ in 0..n {
        std::hint::black_box(phonemize_zh(s));
    }
    eprintln!("kokoro_g2p: 30-char sentence {:.3} ms", t.elapsed().as_secs_f64() * 1000.0 / n as f64);
}
