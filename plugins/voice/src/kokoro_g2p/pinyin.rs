//! pypinyin 0.55 (MIT) `lazy_pinyin(word, style=INITIALS | FINALS_TONE3, neutral_tone_with_five=True)` with the
//! phrase table misaki loads (pypinyin phrases + pypinyin-dict large_pinyin + misaki's own phrases, 地 -> de).
//! Only first readings are kept (lazy_pinyin never looks past them). Phrases whose first readings equal the
//! per-character defaults are dropped at export unless pypinyin's forward max match needs them (export_data.py).

use super::util::{chars, substr, CharMap, Reader, StrTable};

pub struct Pinyin {
    /// (initial, final with tone digit) as pypinyin's strict style conversion returns them.
    syl: Vec<(String, String)>,
    han: Vec<(u32, u32)>,
    single: CharMap<u16>,
    phrases: StrTable,
    phrase_off: Vec<u32>,
    phrase_syl: Vec<u16>,
    numeric: Vec<(u32, u32)>,
}

impl Pinyin {
    pub fn load(r: &mut Reader) -> Pinyin {
        let n = r.u16();
        let syl = (0..n).map(|_| (r.s().to_string(), r.s().to_string())).collect();
        let n = r.u32();
        let han = (0..n).map(|_| (r.u32(), r.u32())).collect();
        let n = r.u32();
        let mut single = CharMap::new();
        for _ in 0..n {
            let c = r.u32();
            single.push(c, r.u16());
        }
        let n = r.u32();
        let mut phrases = StrTable::default();
        let mut phrase_off = vec![0u32];
        let mut phrase_syl = Vec::new();
        for _ in 0..n {
            phrases.push(r.s());
            let k = r.u8();
            for _ in 0..k {
                phrase_syl.push(r.u16());
            }
            phrase_off.push(phrase_syl.len() as u32);
        }
        phrases.finish();
        let n = r.u32();
        let numeric = (0..n).map(|_| (r.u32(), r.u32())).collect();
        Pinyin { syl, han, single, phrases, phrase_off, phrase_syl, numeric }
    }

    fn in_ranges(v: &[(u32, u32)], c: char) -> bool {
        let c = c as u32;
        let i = v.partition_point(|r| r.1 < c);
        i < v.len() && v[i].0 <= c
    }

    /// pypinyin RE_HANS for one character.
    pub fn is_han(&self, c: char) -> bool {
        Self::in_ranges(&self.han, c)
    }

    /// Python str.isnumeric for one character.
    pub fn is_numeric(&self, c: char) -> bool {
        Self::in_ranges(&self.numeric, c)
    }

    fn mmseg(&self, text: &[char]) -> Vec<String> {
        let mut out = Vec::new();
        let mut start = 0;
        let n = text.len();
        'outer: while start < n {
            let mut last_valid = 0usize; // length of the longest phrase found
            let mut word = String::new();
            for index in start..n {
                word.push(text[index]);
                if self.phrases.has_prefix(&word) {
                    if self.phrases.find(&word).is_some() {
                        last_valid = index + 1 - start;
                    }
                } else {
                    if last_valid > 0 {
                        out.push(substr(text, start, start + last_valid));
                        start += last_valid;
                    } else {
                        out.push(text[start].to_string());
                        start += 1;
                    }
                    continue 'outer;
                }
            }
            // the whole remainder matched the prefix set
            if last_valid > 0 {
                out.push(substr(text, start, start + last_valid));
                start += last_valid;
            } else {
                let rest = substr(text, start, n);
                if self.phrases.find(&rest).is_none() {
                    for &c in &text[start..] {
                        out.push(c.to_string());
                    }
                } else {
                    out.push(rest);
                }
                break;
            }
        }
        out
    }

    fn push_syl(&self, out: &mut Vec<(String, String)>, id: u16) {
        out.push(self.syl[id as usize].clone());
    }

    /// One (initial, final) pair per pinyin item, as lazy_pinyin with the two styles yields them.
    pub fn lazy(&self, word: &str) -> Vec<(String, String)> {
        let c = chars(word);
        let mut out = Vec::new();
        if c.is_empty() {
            return out;
        }
        // simple_seg: runs of han / non-han
        let mut i = 0;
        while i < c.len() {
            let h = self.is_han(c[i]);
            let st = i;
            while i < c.len() && self.is_han(c[i]) == h {
                i += 1;
            }
            let run = &c[st..i];
            if !h {
                let s: String = run.iter().collect();
                out.push((s.clone(), s));
                continue;
            }
            for seg in self.mmseg(run) {
                if let Some(pi) = self.phrases.find(&seg) {
                    let (a, b) = (self.phrase_off[pi] as usize, self.phrase_off[pi + 1] as usize);
                    for k in a..b {
                        self.push_syl(&mut out, self.phrase_syl[k]);
                    }
                } else {
                    for ch in seg.chars() {
                        match self.single.get(ch) {
                            Some(id) => self.push_syl(&mut out, id),
                            None => out.push((ch.to_string(), ch.to_string())),
                        }
                    }
                }
            }
        }
        out
    }
}
