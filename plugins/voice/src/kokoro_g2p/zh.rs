//! misaki 0.9.4 ZHG2P(version="1.1"): zh.py, zh_frontend.py and tone_sandhi.py (Apache-2.0, adapted from
//! PaddleSpeech). Every rule, including its quirks, follows the Python source in the same order.

use std::collections::{HashMap, HashSet};

use super::cn2an::an2cn_transform;
use super::jieba::Jieba;
use super::lists;
use super::pinyin::Pinyin;
use super::util::{chars, last_char, py_isspace, py_strip, retone, substr};

const BU: char = '不';
const YI: char = '一';
const UNK: &str = "❓";
const SANDHI_PUNC: &str = "、：，；。？！“”‘’':,;.?!";
const FRONT_PUNC: &str = ";:,.!?—…\"()“”";

fn x_eng(pos: &str) -> bool {
    pos == "x" || pos == "eng"
}

pub struct Zh {
    jieba: Jieba,
    py: Pinyin,
    must_neural: HashSet<&'static str>,
    must_not_neural: HashSet<&'static str>,
    must_erhua: HashSet<&'static str>,
    not_erhua: HashSet<&'static str>,
    zh_map: HashMap<&'static str, &'static str>,
}

fn zh_map() -> HashMap<&'static str, &'static str> {
    let pairs: [(&str, &str); 59] = [
        ("b", "ㄅ"), ("p", "ㄆ"), ("m", "ㄇ"), ("f", "ㄈ"), ("d", "ㄉ"), ("t", "ㄊ"), ("n", "ㄋ"), ("l", "ㄌ"),
        ("g", "ㄍ"), ("k", "ㄎ"), ("h", "ㄏ"), ("j", "ㄐ"), ("q", "ㄑ"), ("x", "ㄒ"), ("zh", "ㄓ"), ("ch", "ㄔ"),
        ("sh", "ㄕ"), ("r", "ㄖ"), ("z", "ㄗ"), ("c", "ㄘ"), ("s", "ㄙ"), ("a", "ㄚ"), ("o", "ㄛ"), ("e", "ㄜ"),
        ("ie", "ㄝ"), ("ai", "ㄞ"), ("ei", "ㄟ"), ("ao", "ㄠ"), ("ou", "ㄡ"), ("an", "ㄢ"), ("en", "ㄣ"),
        ("ang", "ㄤ"), ("eng", "ㄥ"), ("er", "ㄦ"), ("i", "ㄧ"), ("u", "ㄨ"), ("v", "ㄩ"), ("ii", "ㄭ"),
        ("iii", "十"), ("ve", "月"), ("ia", "压"), ("ian", "言"), ("iang", "阳"), ("iao", "要"), ("in", "阴"),
        ("ing", "应"), ("iong", "用"), ("iou", "又"), ("ong", "中"), ("ua", "穵"), ("uai", "外"), ("uan", "万"),
        ("uang", "王"), ("uei", "为"), ("uen", "文"), ("ueng", "瓮"), ("uo", "我"), ("van", "元"), ("vn", "云"),
    ];
    let mut m: HashMap<&'static str, &'static str> = pairs.into_iter().collect();
    for p in [";", ":", ",", ".", "!", "?", "/", "—", "…", "\"", "(", ")", "“", "”", " ", "1", "2", "3", "4", "5", "R"] {
        m.insert(p, p);
    }
    m
}

struct Token {
    tag: String,
    whitespace: String,
    phonemes: Option<String>,
}

impl Zh {
    pub fn new(jieba: Jieba, py: Pinyin) -> Zh {
        Zh {
            jieba,
            py,
            must_neural: lists::MUST_NEURAL_TONE_WORDS.iter().copied().collect(),
            must_not_neural: lists::MUST_NOT_NEURAL_TONE_WORDS.iter().copied().collect(),
            must_erhua: lists::MUST_ERHUA.iter().copied().collect(),
            not_erhua: lists::NOT_ERHUA.iter().copied().collect(),
            zh_map: zh_map(),
        }
    }

    // ------------------------------------------------------------- pinyin helpers

    fn finals_tone3(&self, word: &str) -> Vec<String> {
        let mut f: Vec<String> = self.py.lazy(word).into_iter().map(|x| x.1).collect();
        for (i, c) in word.chars().enumerate() {
            if c == '嗯' && i < f.len() {
                f[i] = "n2".into();
            }
        }
        f
    }

    fn initials_finals(&self, word: &str) -> (Vec<String>, Vec<String>) {
        let pairs = self.py.lazy(word);
        let mut ini: Vec<String> = pairs.iter().map(|x| x.0.clone()).collect();
        let mut fin: Vec<String> = pairs.into_iter().map(|x| x.1).collect();
        for (i, c) in word.chars().enumerate() {
            if c == '嗯' && i < fin.len() {
                fin[i] = "n2".into();
            }
        }
        for (c, v) in ini.iter_mut().zip(fin.iter_mut()) {
            let vc = chars(v);
            if vc.len() >= 2 && vc[0] == 'i' && vc[1].is_numeric() {
                if ["z", "c", "s"].contains(&c.as_str()) {
                    *v = v.replace('i', "ii");
                } else if ["zh", "ch", "sh", "r"].contains(&c.as_str()) {
                    *v = v.replace('i', "iii");
                }
            }
        }
        (ini, fin)
    }

    fn all_tone_three(finals: &[String]) -> bool {
        finals.iter().all(|x| last_char(x) == Some('3'))
    }

    fn is_reduplication(word: &str) -> bool {
        let c = chars(word);
        c.len() == 2 && c[0] == c[1]
    }

    // ------------------------------------------------------------- pre-merge

    fn merge_bu(&self, seg: Vec<(String, String)>) -> Vec<(String, String)> {
        let mut out = Vec::new();
        for i in 0..seg.len() {
            let (mut word, pos) = seg[i].clone();
            if !x_eng(&pos) && i > 0 && seg[i - 1].0 == BU.to_string() {
                word = format!("{}{}", seg[i - 1].0, word);
            }
            let next_pos = seg.get(i + 1).map(|x| x.1.as_str());
            if word != BU.to_string() || next_pos.is_none() || x_eng(next_pos.unwrap()) {
                out.push((word, pos));
            }
        }
        out
    }

    fn merge_yi(&self, seg: Vec<(String, String)>) -> Vec<(String, String)> {
        let yi = YI.to_string();
        let mut new: Vec<(String, String)> = Vec::new();
        let mut skip = false;
        for i in 0..seg.len() {
            if skip {
                skip = false;
                continue;
            }
            let (word, pos) = &seg[i];
            if i >= 1
                && *word == yi
                && i + 1 < seg.len()
                && seg[i - 1].0 == seg[i + 1].0
                && seg[i - 1].1 == "v"
                && !x_eng(&seg[i + 1].1)
            {
                let last = new.last_mut().unwrap();
                last.0 = format!("{}{}{}", last.0, yi, seg[i + 1].0);
                skip = true;
            } else {
                new.push((word.clone(), pos.clone()));
            }
        }
        let mut out: Vec<(String, String)> = Vec::new();
        for (word, pos) in new {
            match out.last_mut() {
                Some(last) if last.0 == yi && !x_eng(&pos) => last.0.push_str(&word),
                _ => out.push((word, pos)),
            }
        }
        out
    }

    fn merge_reduplication(&self, seg: Vec<(String, String)>) -> Vec<(String, String)> {
        let mut out: Vec<(String, String)> = Vec::new();
        for (word, pos) in seg {
            match out.last_mut() {
                Some(last) if last.0 == word && !x_eng(&pos) => last.0.push_str(&word),
                _ => out.push((word, pos)),
            }
        }
        out
    }

    fn sub_finals(&self, seg: &[(String, String)]) -> Vec<Vec<String>> {
        seg.iter()
            .map(|(w, p)| if x_eng(p) { vec!["0".to_string()] } else { self.finals_tone3(w) })
            .collect()
    }

    fn merge_three(&self, seg: Vec<(String, String)>, second: bool) -> Vec<(String, String)> {
        let sf = self.sub_finals(&seg);
        let mut merge_last = vec![false; seg.len()];
        let mut out: Vec<(String, String)> = Vec::new();
        for i in 0..seg.len() {
            let (word, pos) = &seg[i];
            let cond = if i == 0 || x_eng(pos) || merge_last[i - 1] {
                false
            } else if second {
                sf[i - 1].last().and_then(|x| last_char(x)) == Some('3')
                    && sf[i].first().and_then(|x| last_char(x)) == Some('3')
            } else {
                Self::all_tone_three(&sf[i - 1]) && Self::all_tone_three(&sf[i])
            };
            if cond
                && !Self::is_reduplication(&seg[i - 1].0)
                && seg[i - 1].0.chars().count() + word.chars().count() <= 3
            {
                out.last_mut().unwrap().0.push_str(word);
                merge_last[i] = true;
            } else {
                out.push((word.clone(), pos.clone()));
            }
        }
        out
    }

    fn merge_er(&self, seg: Vec<(String, String)>) -> Vec<(String, String)> {
        let mut out: Vec<(String, String)> = Vec::new();
        for (i, (word, pos)) in seg.into_iter().enumerate() {
            if i >= 1 && word == "儿" && !x_eng(&out.last().unwrap().1) {
                out.last_mut().unwrap().0.push_str(&word);
            } else {
                out.push((word, pos));
            }
        }
        out
    }

    fn pre_merge(&self, seg: Vec<(String, String)>) -> Vec<(String, String)> {
        let seg = self.merge_bu(seg);
        let seg = self.merge_yi(seg);
        let seg = self.merge_reduplication(seg);
        let seg = self.merge_three(seg, false);
        let seg = self.merge_three(seg, true);
        self.merge_er(seg)
    }

    // ------------------------------------------------------------- tone sandhi

    fn split_word(&self, word: &str) -> (String, String) {
        let mut list = self.jieba.cut_for_search(word);
        list.sort_by_key(|w| w.chars().count());
        let first = list[0].clone();
        let wc = chars(word);
        let fl = first.chars().count();
        if word.starts_with(&first) {
            (first, substr(&wc, fl.min(wc.len()), wc.len()))
        } else {
            (substr(&wc, 0, wc.len().saturating_sub(fl)), first)
        }
    }

    fn in_neural(&self, w: &[char]) -> bool {
        let s: String = w.iter().collect();
        let tail: String = w[w.len().saturating_sub(2)..].iter().collect();
        self.must_neural.contains(s.as_str()) || self.must_neural.contains(tail.as_str())
    }

    fn neural_sandhi(&self, word: &str, pos: &str, mut finals: Vec<String>) -> Vec<String> {
        if self.must_not_neural.contains(word) {
            return finals;
        }
        let w = chars(word);
        let n = w.len();
        let p0 = pos.chars().next().unwrap_or(' ');
        // Correction, not in misaki: an idiom of four or more characters that is not an AABB doubling keeps
        // the full tone on its repeated character (闪闪发光 shan2 shan3, not shan3 shan5).
        // gold_tests::CORRECTIONS lists the affected sentences.
        let aabb = n == 4 && w[0] == w[1] && w[2] == w[3];
        let idiom = n >= 4 && !aabb;
        for j in 1..n {
            if w[j] == w[j - 1] && "nva".contains(p0) && j < finals.len() && !idiom {
                finals[j] = retone(&finals[j], '5');
            }
        }
        let ge = w.iter().position(|&c| c == '个');
        let last = w.last().copied();
        let set_last = |f: &mut Vec<String>| {
            if let Some(x) = f.last_mut() {
                *x = retone(x, '5');
            }
        };
        if n >= 1 && "吧呢啊呐噻嘛吖嗨呐哦哒滴哩哟喽啰耶喔诶".contains(last.unwrap()) {
            set_last(&mut finals);
        } else if n >= 1 && "的地得".contains(last.unwrap()) {
            set_last(&mut finals);
        } else if n == 1 && "了着过".contains(w[0]) && ["ul", "uz", "ug"].contains(&pos) {
            set_last(&mut finals);
        } else if n > 1 && "们子".contains(last.unwrap()) && ["r", "n"].contains(&pos) {
            set_last(&mut finals);
        } else if n > 1 && "上下".contains(last.unwrap()) && ["s", "l", "f"].contains(&pos) {
            set_last(&mut finals);
        } else if n > 1 && "来去".contains(last.unwrap()) && "上下进出回过起开".contains(w[n - 2]) {
            set_last(&mut finals);
        } else if (ge.is_some_and(|g| {
            g >= 1 && (self.py.is_numeric(w[g - 1]) || "几有两半多各整每做是".contains(w[g - 1]))
        })) || word == "个"
        {
            let g = ge.unwrap();
            if g < finals.len() {
                finals[g] = retone(&finals[g], '5');
            }
        } else if self.in_neural(&w) {
            set_last(&mut finals);
        }
        let (a, b) = self.split_word(word);
        let la = a.chars().count().min(finals.len());
        let mut f1: Vec<String> = finals[..la].to_vec();
        let mut f2: Vec<String> = finals[la..].to_vec();
        for (sub, f) in [(a, &mut f1), (b, &mut f2)] {
            let sc = chars(&sub);
            if !sc.is_empty() && self.in_neural(&sc) {
                if let Some(x) = f.last_mut() {
                    *x = retone(x, '5');
                }
            }
        }
        f1.extend(f2);
        f1
    }

    fn bu_sandhi(&self, word: &str, mut finals: Vec<String>) -> Vec<String> {
        let w = chars(word);
        if w.len() == 3 && w[1] == BU {
            if finals.len() > 1 {
                finals[1] = retone(&finals[1], '5');
            }
        } else {
            for i in 0..w.len() {
                if w[i] == BU && i + 1 < w.len() && i + 1 < finals.len() && last_char(&finals[i + 1]) == Some('4') {
                    finals[i] = retone(&finals[i], '2');
                }
            }
        }
        finals
    }

    fn yi_sandhi(&self, word: &str, mut finals: Vec<String>) -> Vec<String> {
        let w = chars(word);
        if w.contains(&YI) && w.iter().filter(|&&c| c != YI).all(|&c| self.py.is_numeric(c)) {
            return finals;
        } else if w.len() == 3 && w[1] == YI && w[0] == w[2] {
            if finals.len() > 1 {
                finals[1] = retone(&finals[1], '5');
            }
        } else if word.starts_with("第一") {
            if finals.len() > 1 {
                finals[1] = retone(&finals[1], '1');
            }
        } else {
            for i in 0..w.len() {
                if w[i] == YI && i + 1 < w.len() && i + 1 < finals.len() {
                    let t = last_char(&finals[i + 1]);
                    if t == Some('4') || t == Some('5') {
                        finals[i] = retone(&finals[i], '2');
                    } else if !SANDHI_PUNC.contains(w[i + 1]) {
                        finals[i] = retone(&finals[i], '4');
                    }
                }
            }
        }
        finals
    }

    fn three_sandhi(&self, word: &str, mut finals: Vec<String>) -> Vec<String> {
        let n = word.chars().count();
        let two = |x: &mut String| *x = retone(x, '2');
        if n == 2 && Self::all_tone_three(&finals) {
            if !finals.is_empty() {
                two(&mut finals[0]);
            }
        } else if n == 3 {
            let (a, _) = self.split_word(word);
            let la = a.chars().count();
            if Self::all_tone_three(&finals) {
                if la == 2 && finals.len() > 1 {
                    two(&mut finals[0]);
                    two(&mut finals[1]);
                } else if la == 1 && finals.len() > 1 {
                    two(&mut finals[1]);
                }
            } else {
                let la = la.min(finals.len());
                let mut l0: Vec<String> = finals[..la].to_vec();
                let mut l1: Vec<String> = finals[la..].to_vec();
                if Self::all_tone_three(&l0) && l0.len() == 2 {
                    two(&mut l0[0]);
                }
                if Self::all_tone_three(&l1) && l1.len() == 2 {
                    two(&mut l1[0]);
                } else if !Self::all_tone_three(&l1)
                    && last_char(&l1[0]) == Some('3')
                    && l0.last().and_then(|x| last_char(x)) == Some('3')
                {
                    let k = l0.len() - 1;
                    two(&mut l0[k]);
                }
                l0.extend(l1);
                finals = l0;
            }
        } else if n == 4 {
            let k = 2.min(finals.len());
            let mut out = Vec::new();
            for mut sub in [finals[..k].to_vec(), finals[k..].to_vec()] {
                if Self::all_tone_three(&sub) && !sub.is_empty() {
                    two(&mut sub[0]);
                }
                out.extend(sub);
            }
            finals = out;
        }
        finals
    }

    fn modified_tone(&self, word: &str, pos: &str, finals: Vec<String>) -> Vec<String> {
        let f = self.bu_sandhi(word, finals);
        let f = self.yi_sandhi(word, f);
        let f = self.neural_sandhi(word, pos, f);
        self.three_sandhi(word, f)
    }

    fn merge_erhua(&self, ini: Vec<String>, mut fin: Vec<String>, word: &str, pos: &str) -> (Vec<String>, Vec<String>) {
        let w = chars(word);
        let n = fin.len();
        if n >= 1 && n - 1 < w.len() && w[n - 1] == '儿' && fin[n - 1] == "er1" {
            fin[n - 1] = "er2".into();
        }
        if !self.must_erhua.contains(word) && (self.not_erhua.contains(word) || ["a", "j", "nr"].contains(&pos)) {
            return (ini, fin);
        }
        if fin.len() != w.len() {
            return (ini, fin);
        }
        let tail: String = w[w.len().saturating_sub(2)..].iter().collect();
        let mut ni: Vec<String> = Vec::new();
        let mut nf: Vec<String> = Vec::new();
        for (i, phn) in fin.iter().enumerate() {
            if i == n - 1
                && w[i] == '儿'
                && (phn == "er2" || phn == "er5")
                && !self.not_erhua.contains(tail.as_str())
                && !nf.is_empty()
            {
                let l = nf.last_mut().unwrap();
                let mut c = chars(l);
                let t = c.pop();
                let mut s: String = c.into_iter().collect();
                s.push('R');
                if let Some(t) = t {
                    s.push(t);
                }
                *l = s;
            } else {
                ni.push(ini[i].clone());
                nf.push(phn.clone());
            }
        }
        (ni, nf)
    }

    // ------------------------------------------------------------- frontend

    fn phones(&self, ini: &[String], fin: &[String]) -> String {
        let mut phones: Vec<&str> = Vec::new();
        for (c, v) in ini.iter().zip(fin.iter()) {
            if !c.is_empty() {
                phones.push(c);
            }
            let v_in_punc = v.chars().count() == 1 && FRONT_PUNC.contains(v.as_str());
            if !v.is_empty() && (!v_in_punc || v != c) {
                phones.push(v);
            }
        }
        let s = phones.join("_").replace("_eR", "_er").replace('R', "_R");
        let mut t = String::new();
        for ch in s.chars() {
            if ch.is_numeric() && ch.to_digit(10).is_some() || ch.is_ascii_digit() {
                t.push('_');
            }
            t.push(ch);
        }
        t.split('_').map(|p| self.zh_map.get(p).copied().unwrap_or(UNK)).collect()
    }

    pub fn frontend(&self, text: &str) -> String {
        let seg = self.pre_merge(self.jieba.pos_cut(text));
        let mut tokens: Vec<Token> = Vec::new();
        for (word, mut pos) in seg {
            let wc = chars(&word);
            let is_punc = wc.len() == 1 && FRONT_PUNC.contains(wc[0]);
            if pos == "x"
                && !wc.is_empty()
                && *wc.iter().min().unwrap() >= '\u{4E00}'
                && *wc.iter().max().unwrap() <= '\u{9FFF}'
            {
                pos = "X".into();
            } else if pos != "x" && is_punc {
                pos = "x".into();
            }
            if x_eng(&pos) {
                if !py_isspace(&word) {
                    let ph = (pos == "x" && is_punc).then(|| word.clone());
                    tokens.push(Token { tag: pos, whitespace: String::new(), phonemes: ph });
                } else if let Some(t) = tokens.last_mut() {
                    t.whitespace.push_str(&word);
                }
                continue;
            } else if let Some(t) = tokens.last_mut() {
                if !x_eng(&t.tag) && t.whitespace.is_empty() {
                    t.whitespace = "/".into();
                }
            }
            let (ini, fin) = self.initials_finals(&word);
            let fin = self.modified_tone(&word, &pos, fin);
            let (ini, fin) = self.merge_erhua(ini, fin, &word, &pos);
            let ph = self.phones(&ini, &fin);
            tokens.push(Token { tag: pos, whitespace: String::new(), phonemes: Some(ph) });
        }
        let mut out = String::new();
        for t in tokens {
            out.push_str(t.phonemes.as_deref().unwrap_or(UNK));
            out.push_str(&t.whitespace);
        }
        out
    }

    pub fn map_punctuation(text: &str) -> String {
        let t = text
            .replace('、', ", ")
            .replace('，', ", ")
            .replace('。', ". ")
            .replace('．', ". ")
            .replace('！', "! ")
            .replace('：', ": ")
            .replace('；', "; ")
            .replace('？', "? ")
            .replace('«', " “")
            .replace('»', "” ")
            .replace('《', " “")
            .replace('》', "” ")
            .replace('「', " “")
            .replace('」', "” ")
            .replace('【', " “")
            .replace('】', "” ")
            .replace('（', " (")
            .replace('）', ") ");
        py_strip(&t).to_string()
    }

    /// ZHG2P.__call__: one chunk of text to phonemes. `en` phonemizes the English runs.
    pub fn g2p(&self, text: &str, en: &dyn Fn(&str) -> String) -> String {
        if py_strip(text).is_empty() {
            return String::new();
        }
        let text = an2cn_transform(text);
        let text = Self::map_punctuation(&text);
        let c = chars(&text);
        let is_en_char = |ch: char| ch.is_ascii_alphabetic() || ch == ' ' || ch == '\'' || ch == '-';
        let mut segments: Vec<String> = Vec::new();
        let mut i = 0;
        while i < c.len() {
            let mut j = i;
            while j < c.len() && is_en_char(c[j]) {
                j += 1;
            }
            if c[i..j].iter().any(|ch| ch.is_ascii_alphabetic()) {
                let en_seg: String = c[i..j].iter().collect();
                segments.push(en(py_strip(&en_seg)));
                i = j;
                continue;
            }
            let mut j = i;
            while j < c.len() && !c[j].is_ascii_alphabetic() {
                j += 1;
            }
            if j == i {
                i += 1;
                continue;
            }
            let zh_seg: String = c[i..j].iter().collect();
            let zh_seg = py_strip(&zh_seg);
            if !zh_seg.is_empty() {
                segments.push(self.frontend(zh_seg));
            } else {
                segments.push(en(""));
            }
            i = j;
        }
        segments.join(" ")
    }
}
