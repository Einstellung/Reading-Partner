//! misaki 0.9.4 English G2P (en.py, Apache-2.0) without the espeak fallback, on the us_gold/us_silver
//! lexicons. spaCy's tokenizer and tagger are replaced by a rule-based approximation (`tokenize`): the
//! lexicon, stemming, stress, number and context rules after that follow en.py line by line.
//! Words the lexicon cannot read are dropped (misaki with `unk=''`) and logged once.

use std::collections::HashSet;
use std::sync::Mutex;

use super::util::{Reader, StrTable};

const PRIMARY: char = 'ˈ';
const SECONDARY: char = 'ˌ';
const VOWELS: &str = "AIOQWYaiuæɑɒɔəɛɜɪʊʌᵻ";
const CONSONANTS: &str = "bdfhjklmnpstvwzðŋɡɹɾʃʒʤʧθ";
const US_TAUS: &str = "AIOWYiuæɑəɛɪɹʊʌ";
const DIPHTHONGS: &str = "AIOQWYʤʧ";
const PUNCTS: &str = ";:,.!?—…\"“”";
const NON_QUOTE_PUNCTS: &str = ";:,.!?—…";
const SUBTOKEN_JUNKS: &str = "',-._‘’/";
const PUNCT_TAGS: [&str; 10] = [".", ",", "-LRB-", "-RRB-", "``", "\"\"", "''", ":", "$", "#"];
const ORDINALS: [&str; 4] = ["st", "nd", "rd", "th"];

enum Val {
    S(String),
    D(Vec<(String, Option<String>)>),
}

struct Dict {
    keys: StrTable,
    vals: Vec<Val>,
}

fn lower(s: &str) -> String {
    s.to_lowercase()
}
fn upper(s: &str) -> String {
    s.to_uppercase()
}
fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + &c.as_str().to_lowercase(),
        None => String::new(),
    }
}
fn isalpha(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_alphabetic())
}
fn is_digit(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_digit())
}
fn clen(s: &str) -> usize {
    s.chars().count()
}
fn drop_last(s: &str, n: usize) -> String {
    let c: Vec<char> = s.chars().collect();
    c[..c.len().saturating_sub(n)].iter().collect()
}
fn nth_from_end(s: &str, n: usize) -> Option<char> {
    let c: Vec<char> = s.chars().collect();
    (c.len() >= n).then(|| c[c.len() - n])
}

impl Dict {
    fn load(r: &mut Reader) -> Dict {
        let n = r.u32();
        let mut keys = StrTable::default();
        let mut vals = Vec::with_capacity(n as usize);
        for _ in 0..n {
            keys.push(r.s());
            let k = r.u8();
            if k == 0 {
                vals.push(Val::S(r.s().to_string()));
            } else {
                let mut d = Vec::new();
                for _ in 0..k {
                    let t = r.s().to_string();
                    let v = if r.u8() == 1 { Some(r.s().to_string()) } else { None };
                    d.push((t, v));
                }
                vals.push(Val::D(d));
            }
        }
        keys.finish();
        Dict { keys, vals }
    }
    fn raw(&self, k: &str) -> Option<&Val> {
        self.keys.find(k).map(|i| &self.vals[i])
    }
    /// Lookup in Lexicon.grow_dictionary(d) without materialising it.
    fn get(&self, k: &str) -> Option<&Val> {
        if let Some(v) = self.raw(k) {
            return Some(v);
        }
        if clen(k) < 2 {
            return None;
        }
        let l = lower(k);
        if k != l && k == capitalize(&l) {
            return self.raw(&l);
        }
        if k == l {
            let c = capitalize(k);
            if c != k && lower(&c) == k {
                return self.raw(&c);
            }
        }
        None
    }
    fn has(&self, k: &str) -> bool {
        self.get(k).is_some()
    }
}

#[derive(Clone, Default)]
struct Tk {
    text: String,
    tag: String,
    ws: String,
    phonemes: Option<String>,
    is_head: bool,
    alias: Option<String>,
    currency: Option<String>,
    prespace: bool,
}

#[derive(Clone, Copy, Default)]
struct Ctx {
    future_vowel: Option<bool>,
    future_to: bool,
}

fn apply_stress(ps: Option<String>, stress: Option<f64>) -> Option<String> {
    let ps = ps?;
    let Some(stress) = stress else { return Some(ps) };
    let has_p = ps.contains(PRIMARY);
    let has_s = ps.contains(SECONDARY);
    let has_v = ps.chars().any(|c| VOWELS.contains(c));
    let restress = |ps: String| -> String {
        let c: Vec<char> = ps.chars().collect();
        let mut ips: Vec<(f64, char)> = c.iter().enumerate().map(|(i, &p)| (i as f64, p)).collect();
        for i in 0..c.len() {
            if c[i] == PRIMARY || c[i] == SECONDARY {
                if let Some(j) = (i..c.len()).find(|&j| VOWELS.contains(c[j])) {
                    ips[i] = (j as f64 - 0.5, c[i]);
                }
            }
        }
        ips.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap().then(a.1.cmp(&b.1)));
        ips.into_iter().map(|x| x.1).collect()
    };
    let out = if stress < -1.0 {
        ps.replace(PRIMARY, "").replace(SECONDARY, "")
    } else if stress == -1.0 || ((stress == 0.0 || stress == -0.5) && has_p) {
        ps.replace(SECONDARY, "").replace(PRIMARY, &SECONDARY.to_string())
    } else if (stress == 0.0 || stress == 0.5 || stress == 1.0) && !has_p && !has_s {
        if !has_v {
            return Some(ps);
        }
        restress(format!("{SECONDARY}{ps}"))
    } else if stress >= 1.0 && !has_p && has_s {
        ps.replace(SECONDARY, &PRIMARY.to_string())
    } else if stress > 1.0 && !has_p && !has_s {
        if !has_v {
            return Some(ps);
        }
        restress(format!("{PRIMARY}{ps}"))
    } else {
        ps
    };
    Some(out)
}

fn stress_weight(ps: &str) -> usize {
    ps.chars().map(|c| if DIPHTHONGS.contains(c) { 2 } else { 1 }).sum()
}

fn parent_tag(tag: Option<&str>) -> Option<String> {
    let t = tag?;
    Some(if t.starts_with("VB") {
        "VERB".into()
    } else if t.starts_with("NN") {
        "NOUN".into()
    } else if t.starts_with("ADV") || t.starts_with("RB") {
        "ADV".into()
    } else if t.starts_with("ADJ") || t.starts_with("JJ") {
        "ADJ".into()
    } else {
        t.into()
    })
}

// ------------------------------------------------------------------ num2words (English)

const ONES: [&str; 20] = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
    "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS: [&str; 10] = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: [&str; 7] = ["", "thousand", "million", "billion", "trillion", "quadrillion", "quintillion"];

/// num2words(n) split on non-letters, "and" removed (misaki drops it).
fn cardinal_words(n: u64) -> Vec<String> {
    if n == 0 {
        return vec!["zero".into()];
    }
    let mut groups = Vec::new();
    let mut m = n;
    while m > 0 {
        groups.push(m % 1000);
        m /= 1000;
    }
    let mut out = Vec::new();
    for (gi, &g) in groups.iter().enumerate().rev() {
        if g == 0 {
            continue;
        }
        let h = g / 100;
        let r = g % 100;
        if h > 0 {
            out.push(ONES[h as usize].to_string());
            out.push("hundred".into());
        }
        if r > 0 {
            if r < 20 {
                out.push(ONES[r as usize].into());
            } else {
                out.push(TENS[(r / 10) as usize].into());
                if r % 10 > 0 {
                    out.push(ONES[(r % 10) as usize].into());
                }
            }
        }
        if gi > 0 {
            out.push(SCALES[gi].into());
        }
    }
    out
}

fn ordinal_words(n: u64) -> Vec<String> {
    let mut w = cardinal_words(n);
    let last = w.pop().unwrap();
    let o = match last.as_str() {
        "one" => "first".to_string(),
        "two" => "second".into(),
        "three" => "third".into(),
        "five" => "fifth".into(),
        "eight" => "eighth".into(),
        "nine" => "ninth".into(),
        "twelve" => "twelfth".into(),
        s if s.ends_with('y') => format!("{}ieth", &s[..s.len() - 1]),
        s => format!("{s}th"),
    };
    w.push(o);
    w
}

fn year_words(n: u64) -> Vec<String> {
    let (high, low) = (n / 100, n % 100);
    if high == 0 || (high % 10 == 0 && low < 10) || high >= 100 {
        return cardinal_words(n);
    }
    let mut w = cardinal_words(high);
    if low == 0 {
        w.push("hundred".into());
    } else if low < 10 {
        w.push("oh".into());
        w.extend(cardinal_words(low));
    } else {
        w.extend(cardinal_words(low));
    }
    w
}

fn float_words(s: &str) -> Option<Vec<String>> {
    let f: f64 = s.parse().ok()?;
    let repr = format!("{f:?}");
    let (a, b) = repr.split_once('.').unwrap_or((&repr, "0"));
    let mut w = cardinal_words(a.trim_start_matches('-').parse().ok()?);
    w.push("point".into());
    for c in b.chars() {
        w.push(ONES[c.to_digit(10)? as usize].into());
    }
    Some(w)
}

// ------------------------------------------------------------------ lexicon

pub struct En {
    golds: Dict,
    silvers: Dict,
    logged: Mutex<HashSet<String>>,
}

impl En {
    pub fn load(r: &mut Reader) -> En {
        let golds = Dict::load(r);
        let silvers = Dict::load(r);
        En { golds, silvers, logged: Mutex::new(HashSet::new()) }
    }

    fn gold_str(&self, k: &str) -> Option<String> {
        match self.golds.get(k)? {
            Val::S(s) => Some(s.clone()),
            Val::D(d) => d.iter().find(|x| x.0 == "DEFAULT").and_then(|x| x.1.clone()),
        }
    }

    fn gold_tag(&self, k: &str, tag: &str) -> Option<String> {
        match self.golds.get(k)? {
            Val::S(s) => Some(s.clone()),
            Val::D(d) => d.iter().find(|x| x.0 == tag).and_then(|x| x.1.clone()),
        }
    }

    fn get_nnp(&self, word: &str) -> Option<String> {
        let mut ps = String::new();
        for c in word.chars().filter(|c| c.is_alphabetic()) {
            ps.push_str(&self.gold_str(&upper(&c.to_string()))?);
        }
        let ps = apply_stress(Some(ps), Some(0.0))?;
        Some(match ps.rfind(SECONDARY) {
            Some(i) => format!("{}{}{}", &ps[..i], PRIMARY, &ps[i + SECONDARY.len_utf8()..]),
            None => ps,
        })
    }

    fn get_special_case(&self, word: &str, tag: &str, stress: Option<f64>, ctx: Option<Ctx>) -> Option<String> {
        let fv = ctx.and_then(|c| c.future_vowel);
        if tag == "ADD" && (word == "." || word == "/") {
            return self.lookup(if word == "." { "dot" } else { "slash" }, None, Some(-0.5), ctx);
        }
        let sym = match word {
            "%" => Some("percent"),
            "&" => Some("and"),
            "+" => Some("plus"),
            "@" => Some("at"),
            _ => None,
        };
        if let Some(s) = sym {
            return self.lookup(s, None, None, ctx);
        }
        let inner = word.trim_matches('.');
        if inner.contains('.')
            && isalpha(&word.replace('.', ""))
            && word.split('.').map(clen).max().unwrap_or(0) < 3
        {
            return self.get_nnp(word);
        }
        match word {
            "a" | "A" => return Some(if tag == "DT" { "ɐ".into() } else { "ˈA".into() }),
            "am" | "Am" | "AM" => {
                if tag.starts_with("NN") {
                    return self.get_nnp(word);
                } else if ctx.is_none() || fv.is_none() || word != "am" || stress.is_some_and(|s| s > 0.0) {
                    return self.gold_str("am");
                }
                return Some("ɐm".into());
            }
            "an" | "An" | "AN" => {
                if word == "AN" && tag.starts_with("NN") {
                    return self.get_nnp(word);
                }
                return Some("ɐn".into());
            }
            _ => {}
        }
        if word == "I" && tag == "PRP" {
            return Some(format!("{SECONDARY}I"));
        }
        if ["by", "By", "BY"].contains(&word) && parent_tag(Some(tag)).as_deref() == Some("ADV") {
            return Some("bˈI".into());
        }
        if word == "to" || word == "To" || (word == "TO" && (tag == "TO" || tag == "IN")) {
            return match fv {
                None => self.gold_str("to"),
                Some(false) => Some("tə".into()),
                Some(true) => Some("tʊ".into()),
            };
        }
        if word == "in" || word == "In" || (word == "IN" && tag != "NNP") {
            let s = if fv.is_none() || tag != "IN" { PRIMARY.to_string() } else { String::new() };
            return Some(format!("{s}ɪn"));
        }
        if word == "the" || word == "The" || (word == "THE" && tag == "DT") {
            return Some(if fv == Some(true) { "ði".into() } else { "ðə".into() });
        }
        if tag == "IN" && (lower(word) == "vs" || lower(word) == "vs.") {
            return self.lookup("versus", None, None, ctx);
        }
        if ["used", "Used", "USED"].contains(&word) {
            if (tag == "VBD" || tag == "JJ") && ctx.is_some_and(|c| c.future_to) {
                return self.gold_tag("used", "VBD");
            }
            return self.gold_tag("used", "DEFAULT");
        }
        None
    }

    fn is_known(&self, word: &str) -> bool {
        if self.golds.has(word) || ["%", "&", "+", "@"].contains(&word) || self.silvers.has(word) {
            return true;
        }
        if !isalpha(word) || !word.chars().all(|c| c.is_ascii_alphabetic() || c == '\'' || c == '-') {
            return false;
        }
        if clen(word) == 1 {
            return true;
        }
        if word == upper(word) && self.golds.has(&lower(word)) {
            return true;
        }
        let rest: String = word.chars().skip(1).collect();
        rest == upper(&rest)
    }

    fn lookup(&self, word: &str, tag: Option<&str>, stress: Option<f64>, ctx: Option<Ctx>) -> Option<String> {
        let mut word = word.to_string();
        let mut is_nnp = false;
        if word == upper(&word) && !self.golds.has(&word) {
            word = lower(&word);
            is_nnp = tag == Some("NNP");
        }
        let mut val = self.golds.get(&word);
        if val.is_none() && !is_nnp {
            val = self.silvers.get(&word);
        }
        let ps: Option<String> = match val {
            None => None,
            Some(Val::S(s)) => Some(s.clone()),
            Some(Val::D(d)) => {
                let has = |t: &str| d.iter().any(|x| x.0 == t);
                let t: Option<String> = if ctx.is_some_and(|c| c.future_vowel.is_none()) && has("None") {
                    Some("None".into())
                } else if tag.is_some_and(|t| has(t)) {
                    tag.map(|t| t.to_string())
                } else {
                    parent_tag(tag)
                };
                match t.as_deref().and_then(|t| d.iter().find(|x| x.0 == t)) {
                    Some(x) => x.1.clone(),
                    None => d.iter().find(|x| x.0 == "DEFAULT").and_then(|x| x.1.clone()),
                }
            }
        };
        if ps.is_none() || (is_nnp && !ps.as_ref().unwrap().contains(PRIMARY)) {
            if let Some(p) = self.get_nnp(&word) {
                return Some(p);
            }
        }
        apply_stress(ps, stress)
    }

    fn suffix_s(stem: Option<String>) -> Option<String> {
        let stem = stem.filter(|s| !s.is_empty())?;
        let l = stem.chars().last().unwrap();
        Some(if "ptkfθ".contains(l) {
            stem + "s"
        } else if "szʃʒʧʤ".contains(l) {
            stem + "ᵻz"
        } else {
            stem + "z"
        })
    }

    fn stem_s(&self, word: &str, tag: Option<&str>, stress: Option<f64>, ctx: Option<Ctx>) -> Option<String> {
        if clen(word) < 3 || !word.ends_with('s') {
            return None;
        }
        let n = clen(word);
        let stem = if !word.ends_with("ss") && self.is_known(&drop_last(word, 1)) {
            drop_last(word, 1)
        } else if (word.ends_with("'s") || (n > 4 && word.ends_with("es") && !word.ends_with("ies")))
            && self.is_known(&drop_last(word, 2))
        {
            drop_last(word, 2)
        } else if n > 4 && word.ends_with("ies") && self.is_known(&(drop_last(word, 3) + "y")) {
            drop_last(word, 3) + "y"
        } else {
            return None;
        };
        Self::suffix_s(self.lookup(&stem, tag, stress, ctx))
    }

    fn suffix_ed(stem: Option<String>) -> Option<String> {
        let stem = stem.filter(|s| !s.is_empty())?;
        let l = stem.chars().last().unwrap();
        Some(if "pkfθʃsʧ".contains(l) {
            stem + "t"
        } else if l == 'd' {
            stem + "ᵻd"
        } else if l != 't' {
            stem + "d"
        } else if clen(&stem) < 2 {
            stem + "ɪd"
        } else if US_TAUS.contains(nth_from_end(&stem, 2).unwrap()) {
            drop_last(&stem, 1) + "ɾᵻd"
        } else {
            stem + "ᵻd"
        })
    }

    fn stem_ed(&self, word: &str, tag: Option<&str>, stress: Option<f64>, ctx: Option<Ctx>) -> Option<String> {
        if clen(word) < 4 || !word.ends_with('d') {
            return None;
        }
        let stem = if !word.ends_with("dd") && self.is_known(&drop_last(word, 1)) {
            drop_last(word, 1)
        } else if clen(word) > 4
            && word.ends_with("ed")
            && !word.ends_with("eed")
            && self.is_known(&drop_last(word, 2))
        {
            drop_last(word, 2)
        } else {
            return None;
        };
        Self::suffix_ed(self.lookup(&stem, tag, stress, ctx))
    }

    fn suffix_ing(stem: Option<String>) -> Option<String> {
        let stem = stem.filter(|s| !s.is_empty())?;
        if clen(&stem) > 1 && stem.ends_with('t') && US_TAUS.contains(nth_from_end(&stem, 2).unwrap()) {
            return Some(drop_last(&stem, 1) + "ɾɪŋ");
        }
        Some(stem + "ɪŋ")
    }

    fn stem_ing(&self, word: &str, tag: Option<&str>, stress: Option<f64>, ctx: Option<Ctx>) -> Option<String> {
        let n = clen(word);
        if n < 5 || !word.ends_with("ing") {
            return None;
        }
        let base = drop_last(word, 3);
        let doubled = {
            let c: Vec<char> = word.chars().collect();
            (n >= 5 && c[n - 4] == c[n - 5] && "bcdgklmnprstvxz".contains(c[n - 4])) || word.ends_with("cking")
        };
        let stem = if n > 5 && self.is_known(&base) {
            base
        } else if self.is_known(&(base.clone() + "e")) {
            base + "e"
        } else if n > 5 && doubled && self.is_known(&drop_last(word, 4)) {
            drop_last(word, 4)
        } else {
            return None;
        };
        Self::suffix_ing(self.lookup(&stem, tag, stress, ctx))
    }

    fn get_word(&self, word: &str, tag: &str, stress: Option<f64>, ctx: Ctx) -> Option<String> {
        if let Some(ps) = self.get_special_case(word, tag, stress, Some(ctx)) {
            return Some(ps);
        }
        let wl = lower(word);
        let t = Some(tag);
        let mut word = word.to_string();
        let rest: String = word.chars().skip(1).collect();
        if clen(&word) > 1
            && isalpha(&word.replace('\'', ""))
            && word != wl
            && (tag != "NNP" || clen(&word) > 7)
            && !self.golds.has(&word)
            && !self.silvers.has(&word)
            && (word == upper(&word) || rest == lower(&rest))
            && (self.golds.has(&wl)
                || self.silvers.has(&wl)
                || self.stem_s(&wl, t, stress, Some(ctx)).is_some()
                || self.stem_ed(&wl, t, stress, Some(ctx)).is_some()
                || self.stem_ing(&wl, t, stress, Some(ctx)).is_some())
        {
            word = wl;
        }
        if self.is_known(&word) {
            return self.lookup(&word, t, stress, Some(ctx));
        }
        if word.ends_with("s'") && self.is_known(&(drop_last(&word, 2) + "'s")) {
            return self.lookup(&(drop_last(&word, 2) + "'s"), t, stress, Some(ctx));
        }
        if word.ends_with('\'') && self.is_known(&drop_last(&word, 1)) {
            return self.lookup(&drop_last(&word, 1), t, stress, Some(ctx));
        }
        if let Some(s) = self.stem_s(&word, t, stress, Some(ctx)) {
            return Some(s);
        }
        if let Some(s) = self.stem_ed(&word, t, stress, Some(ctx)) {
            return Some(s);
        }
        self.stem_ing(&word, t, Some(stress.unwrap_or(0.5)), Some(ctx))
    }

    fn is_number(word: &str, is_head: bool) -> bool {
        if !word.chars().any(|c| c.is_ascii_digit()) {
            return false;
        }
        let mut w = word;
        for s in ["ing", "'d", "ed", "'s", "st", "nd", "rd", "th", "s"] {
            if let Some(x) = w.strip_suffix(s) {
                w = x;
                break;
            }
        }
        w.chars().enumerate().all(|(i, c)| c.is_ascii_digit() || c == ',' || c == '.' || (is_head && i == 0 && c == '-'))
    }

    fn get_number(&self, word: &str, currency: Option<&str>, is_head: bool) -> Option<String> {
        let sl = word.chars().rev().take_while(|c| c.is_ascii_lowercase() || *c == '\'').count();
        let suffix: Option<String> = (sl > 0).then(|| word.chars().skip(clen(word) - sl).collect());
        let mut word = drop_last(word, sl);
        let mut result: Vec<String> = Vec::new();
        let lk = |w: &str, s: Option<f64>| self.lookup(w, None, s, None);
        if let Some(rest) = word.strip_prefix('-') {
            result.extend(lk("minus", None));
            word = rest.to_string();
        }
        let extend = |words: Vec<String>, result: &mut Vec<String>| {
            for w in words {
                if w != "and" {
                    if let Some(p) = lk(&w, if w == "point" { Some(-2.0) } else { None }) {
                        result.push(p);
                    }
                }
            }
        };
        let num = |s: &str| -> Option<u64> { s.parse().ok() };
        let suffix_ord = suffix.as_deref().is_some_and(|s| ORDINALS.contains(&s));
        let is_cur = currency.is_some_and(|c| "$£€".contains(c));
        if is_digit(&word) && suffix_ord {
            extend(ordinal_words(num(&word)?), &mut result);
        } else if result.is_empty() && clen(&word) == 4 && !is_cur && is_digit(&word) {
            extend(year_words(num(&word)?), &mut result);
        } else if !is_head && !word.contains('.') {
            let n = word.replace(',', "");
            if n.starts_with('0') || clen(&n) > 3 {
                for d in n.chars() {
                    extend(cardinal_words(d.to_digit(10)? as u64), &mut result);
                }
            } else if clen(&n) == 3 && !n.ends_with("00") {
                let c: Vec<char> = n.chars().collect();
                extend(cardinal_words(c[0].to_digit(10)? as u64), &mut result);
                if c[1] == '0' {
                    result.extend(lk("O", Some(-2.0)));
                    extend(cardinal_words(c[2].to_digit(10)? as u64), &mut result);
                } else {
                    extend(cardinal_words(num(&n[1..])?), &mut result);
                }
            } else {
                extend(cardinal_words(num(&n)?), &mut result);
            }
        } else if word.matches('.').count() > 1 || !is_head {
            for part in word.replace(',', "").split('.') {
                if part.is_empty() {
                    continue;
                }
                let c: Vec<char> = part.chars().collect();
                if c[0] == '0' || (c.len() != 2 && c[1..].iter().any(|&x| x != '0')) {
                    for d in c {
                        extend(cardinal_words(d.to_digit(10)? as u64), &mut result);
                    }
                } else {
                    extend(cardinal_words(num(part)?), &mut result);
                }
            }
        } else if is_cur && (!word.contains('.') || word.split('.').nth(1).is_some_and(|c| clen(c) < 3)) {
            let (dollar, cent) = match currency.unwrap() {
                "$" => ("dollar", "cent"),
                "£" => ("pound", "pence"),
                _ => ("euro", "cent"),
            };
            let w = word.replace(',', "");
            let mut pairs: Vec<(u64, &str)> =
                w.split('.').zip([dollar, cent]).map(|(n, u)| (n.parse().unwrap_or(0), u)).collect();
            if pairs.len() > 1 {
                if pairs[1].0 == 0 {
                    pairs.truncate(1);
                } else if pairs[0].0 == 0 {
                    pairs.remove(0);
                }
            }
            for (i, (n, unit)) in pairs.into_iter().enumerate() {
                if i > 0 {
                    result.extend(lk("and", None));
                }
                extend(cardinal_words(n), &mut result);
                if n != 1 && unit != "pence" {
                    result.extend(self.stem_s(&format!("{unit}s"), None, None, None));
                } else {
                    result.extend(lk(unit, None));
                }
            }
        } else {
            let words = if is_digit(&word) {
                cardinal_words(num(&word)?)
            } else if !word.contains('.') {
                let n = num(&word.replace(',', ""))?;
                if suffix_ord {
                    ordinal_words(n)
                } else {
                    cardinal_words(n)
                }
            } else {
                let w = word.replace(',', "");
                if let Some(frac) = w.strip_prefix('.') {
                    let mut v = vec!["point".to_string()];
                    for d in frac.chars() {
                        v.extend(cardinal_words(d.to_digit(10)? as u64));
                    }
                    v
                } else {
                    float_words(&w)?
                }
            };
            extend(words, &mut result);
        }
        if result.is_empty() {
            return None;
        }
        let r = result.join(" ");
        match suffix.as_deref() {
            Some("s") | Some("'s") => Self::suffix_s(Some(r)),
            Some("ed") | Some("'d") => Self::suffix_ed(Some(r)),
            Some("ing") => Self::suffix_ing(Some(r)),
            _ => Some(r),
        }
    }

    fn append_currency(&self, ps: String, currency: Option<&str>) -> String {
        let unit = match currency {
            Some("$") => "dollar",
            Some("£") => "pound",
            Some("€") => "euro",
            _ => return ps,
        };
        match self.stem_s(&format!("{unit}s"), None, None, None) {
            Some(c) => format!("{ps} {c}"),
            None => ps,
        }
    }

    fn lexicon(&self, tk: &Tk, ctx: Ctx) -> Option<String> {
        let word = tk.alias.as_ref().unwrap_or(&tk.text).replace(['‘', '’'], "'");
        let stress = if word == lower(&word) {
            None
        } else if word == upper(&word) {
            Some(2.0)
        } else {
            Some(0.5)
        };
        if let Some(ps) = self.get_word(&word, &tk.tag, stress, ctx) {
            return Some(self.append_currency(ps, tk.currency.as_deref()));
        }
        if Self::is_number(&word, tk.is_head) {
            return self.get_number(&word, tk.currency.as_deref(), tk.is_head);
        }
        None
    }

    fn log_unknown(&self, word: &str) {
        let mut l = self.logged.lock().unwrap();
        if l.insert(word.to_string()) {
            eprintln!("[kokoro_g2p] English word not in lexicon, skipped: {word:?}");
        }
    }

    // ------------------------------------------------------------------ G2P.__call__

    fn token_context(ctx: Ctx, ps: Option<&str>, tk: &Tk) -> Ctx {
        let mut vowel = ctx.future_vowel;
        if let Some(ps) = ps.filter(|p| !p.is_empty()) {
            if let Some(c) = ps.chars().find(|&c| VOWELS.contains(c) || CONSONANTS.contains(c) || NON_QUOTE_PUNCTS.contains(c)) {
                vowel = if NON_QUOTE_PUNCTS.contains(c) { None } else { Some(VOWELS.contains(c)) };
            }
        }
        let future_to = tk.text == "to" || tk.text == "To" || (tk.text == "TO" && (tk.tag == "TO" || tk.tag == "IN"));
        Ctx { future_vowel: vowel, future_to }
    }

    fn merge(tokens: &[Tk], unk: Option<&str>) -> Tk {
        let n = tokens.len();
        let mut text = String::new();
        for (i, t) in tokens.iter().enumerate() {
            text.push_str(&t.text);
            if i + 1 < n {
                text.push_str(&t.ws);
            }
        }
        let weight = |t: &Tk| -> usize { t.text.chars().map(|c| if lower(&c.to_string()) == c.to_string() { 1 } else { 2 }).sum() };
        let mut best = &tokens[0];
        for t in tokens {
            if weight(t) > weight(best) {
                best = t;
            }
        }
        let phonemes = unk.map(|u| {
            let mut p = String::new();
            for t in tokens {
                if t.prespace && !p.is_empty() && !p.chars().last().unwrap().is_whitespace() && t.phonemes.as_deref().is_some_and(|x| !x.is_empty()) {
                    p.push(' ');
                }
                p.push_str(t.phonemes.as_deref().unwrap_or(u));
            }
            p
        });
        let currency = tokens.iter().filter_map(|t| t.currency.clone()).max();
        Tk {
            text,
            tag: best.tag.clone(),
            ws: tokens[n - 1].ws.clone(),
            phonemes,
            is_head: tokens[0].is_head,
            alias: None,
            currency,
            prespace: tokens[0].prespace,
        }
    }

    fn resolve_tokens(tokens: &mut [Tk]) {
        let n = tokens.len();
        let mut text = String::new();
        for (i, t) in tokens.iter().enumerate() {
            text.push_str(&t.text);
            if i + 1 < n {
                text.push_str(&t.ws);
            }
        }
        let classes: HashSet<u8> = text
            .chars()
            .filter(|c| !SUBTOKEN_JUNKS.contains(*c))
            .map(|c| if c.is_alphabetic() { 0 } else if c.is_ascii_digit() { 1 } else { 2 })
            .collect();
        let prespace = text.contains(' ') || text.contains('/') || classes.len() > 1;
        for i in 0..n {
            if tokens[i].phonemes.is_none() {
                if i == n - 1 && tokens[i].text.chars().count() == 1 && NON_QUOTE_PUNCTS.contains(tokens[i].text.as_str()) {
                    tokens[i].phonemes = Some(tokens[i].text.clone());
                } else if tokens[i].text.chars().all(|c| SUBTOKEN_JUNKS.contains(c)) {
                    tokens[i].phonemes = Some(String::new());
                }
            } else if i > 0 {
                tokens[i].prespace = prespace;
            }
        }
        if prespace {
            return;
        }
        let mut idx: Vec<(bool, usize, usize)> = tokens
            .iter()
            .enumerate()
            .filter(|(_, t)| t.phonemes.as_deref().is_some_and(|p| !p.is_empty()))
            .map(|(i, t)| {
                let p = t.phonemes.as_deref().unwrap();
                (p.contains(PRIMARY), stress_weight(p), i)
            })
            .collect();
        if idx.len() == 2 && tokens[idx[0].2].text.chars().count() == 1 {
            let i = idx[1].2;
            tokens[i].phonemes = apply_stress(tokens[i].phonemes.take(), Some(-0.5));
            return;
        }
        if idx.len() < 2 || idx.iter().filter(|x| x.0).count() <= (idx.len() + 1) / 2 {
            return;
        }
        idx.sort();
        let half = idx.len() / 2;
        for &(_, _, i) in &idx[..half] {
            tokens[i].phonemes = apply_stress(tokens[i].phonemes.take(), Some(-0.5));
        }
    }

    /// One line of English to tokens (text, phonemes, whitespace), as misaki's G2P returns them.
    fn g2p_tokens(&self, text: &str) -> Vec<Tk> {
        let toks = tokenize(text.trim_start());
        let words = retokenize(toks);
        let mut words = words;
        let mut ctx = Ctx::default();
        for w in words.iter_mut().rev() {
            match w {
                Word::One(tk) => {
                    if tk.phonemes.is_none() {
                        tk.phonemes = self.lexicon(tk, ctx);
                        if tk.phonemes.is_none() {
                            self.log_unknown(&tk.text);
                        }
                    }
                    ctx = Self::token_context(ctx, tk.phonemes.as_deref(), tk);
                }
                Word::Many(w) => {
                    let (mut left, mut right) = (0usize, w.len());
                    while left < right {
                        let tk = if w[left..right].iter().any(|t| t.alias.is_some() || t.phonemes.is_some()) {
                            None
                        } else {
                            Some(Self::merge(&w[left..right], None))
                        };
                        let ps = tk.as_ref().and_then(|t| self.lexicon(t, ctx));
                        if let Some(ps) = ps {
                            w[left].phonemes = Some(ps.clone());
                            for x in &mut w[left + 1..right] {
                                x.phonemes = Some(String::new());
                            }
                            ctx = Self::token_context(ctx, Some(&ps), tk.as_ref().unwrap());
                            right = left;
                            left = 0;
                        } else if left + 1 < right {
                            left += 1;
                        } else {
                            right -= 1;
                            let t = &mut w[right];
                            if t.phonemes.is_none() {
                                if t.text.chars().all(|c| SUBTOKEN_JUNKS.contains(c)) {
                                    t.phonemes = Some(String::new());
                                } else {
                                    self.log_unknown(&t.text);
                                }
                            }
                            left = 0;
                        }
                    }
                    Self::resolve_tokens(w);
                }
            }
        }
        words
            .into_iter()
            .map(|w| match w {
                Word::One(t) => t,
                Word::Many(v) => Self::merge(&v, Some("")),
            })
            .map(|mut t| {
                t.phonemes = t.phonemes.map(|p| p.replace('ɾ', "T").replace('ʔ', "t"));
                t
            })
            .collect()
    }

    /// KPipeline(lang_code='a') phonemes: one string per chunk of at most 510 phonemes.
    pub fn pipeline(&self, text: &str) -> Vec<String> {
        let mut out = Vec::new();
        for line in text.trim().split('\n') {
            if line.trim().is_empty() {
                continue;
            }
            let tokens = self.g2p_tokens(line);
            let mut chunk = String::new();
            for t in &tokens {
                let next = format!("{}{}", t.phonemes.as_deref().unwrap_or(""), if t.ws.is_empty() { "" } else { " " });
                if chunk.chars().count() + next.trim_end().chars().count() > 510 && !chunk.trim().is_empty() {
                    out.push(chunk.trim().to_string());
                    chunk.clear();
                }
                chunk.push_str(&next);
            }
            let c = chunk.trim().to_string();
            if !c.is_empty() {
                out.push(c);
            }
        }
        out
    }
}

// ------------------------------------------------------------------ retokenize / subtokenize

enum Word {
    One(Tk),
    Many(Vec<Tk>),
}

fn is_apos(c: char) -> bool {
    c == '\'' || c == '‘' || c == '’'
}

/// misaki's SUBTOKEN_REGEX via findall, alternatives tried in order at each position.
fn subtokenize(word: &str) -> Vec<String> {
    let c: Vec<char> = word.chars().collect();
    let n = c.len();
    let lu = |i: usize| i < n && c[i].is_uppercase();
    let ll = |i: usize| i < n && c[i].is_lowercase();
    let l = |i: usize| i < n && c[i].is_alphabetic();
    let d = |i: usize| i < n && c[i].is_ascii_digit();
    let mut out = Vec::new();
    let mut i = 0;
    while i < n {
        let m: Option<usize> = (|| {
            // ^['‘’]+
            if i == 0 && is_apos(c[0]) {
                let mut j = 0;
                while j < n && is_apos(c[j]) {
                    j += 1;
                }
                return Some(j);
            }
            // \p{Lu}(?=\p{Lu}\p{Ll})
            if lu(i) && lu(i + 1) && ll(i + 2) {
                return Some(i + 1);
            }
            // (?:^-)?(?:\d?[,.]?\d)+
            {
                let mut j = i;
                if i == 0 && c[0] == '-' {
                    j = 1;
                }
                let unit = |p: usize| -> Option<usize> {
                    let sep = |q: usize| q < n && (c[q] == ',' || c[q] == '.');
                    if d(p) && sep(p + 1) && d(p + 2) {
                        Some(p + 3)
                    } else if d(p) && d(p + 1) {
                        Some(p + 2)
                    } else if sep(p) && d(p + 1) {
                        Some(p + 2)
                    } else if d(p) {
                        Some(p + 1)
                    } else {
                        None
                    }
                };
                let mut k = j;
                while let Some(e) = unit(k) {
                    k = e;
                }
                if k > j {
                    return Some(k);
                }
            }
            // [-_]+
            if c[i] == '-' || c[i] == '_' {
                let mut j = i;
                while j < n && (c[j] == '-' || c[j] == '_') {
                    j += 1;
                }
                return Some(j);
            }
            // ['‘’]{2,}
            if is_apos(c[i]) && i + 1 < n && is_apos(c[i + 1]) {
                let mut j = i;
                while j < n && is_apos(c[j]) {
                    j += 1;
                }
                return Some(j);
            }
            // \p{L}*?\p{Ll}(?=\p{Lu})  (apostrophe groups ignored)
            {
                let mut j = i;
                while l(j) {
                    if ll(j) && lu(j + 1) {
                        return Some(j + 1);
                    }
                    j += 1;
                }
            }
            // \p{L}+(?:['‘’]\p{L})*
            if l(i) {
                let mut j = i;
                while l(j) {
                    j += 1;
                }
                while j + 1 < n && is_apos(c[j]) && l(j + 1) {
                    j += 2;
                }
                return Some(j);
            }
            // [^-_\p{L}'‘’\d]
            if !(c[i] == '-' || c[i] == '_' || c[i].is_alphabetic() || is_apos(c[i]) || c[i].is_ascii_digit()) {
                return Some(i + 1);
            }
            // ['‘’]+$
            if is_apos(c[i]) && c[i..].iter().all(|&x| is_apos(x)) {
                return Some(n);
            }
            None
        })();
        match m {
            Some(e) if e > i => {
                out.push(c[i..e].iter().collect());
                i = e;
            }
            _ => i += 1,
        }
    }
    out
}

fn retokenize(tokens: Vec<Tk>) -> Vec<Word> {
    let mut words: Vec<Word> = Vec::new();
    let mut currency: Option<String> = None;
    let nt = tokens.len();
    for i in 0..nt {
        let token = &tokens[i];
        let mut tks: Vec<Tk> = if token.alias.is_none() && token.phonemes.is_none() {
            subtokenize(&token.text)
                .into_iter()
                .map(|t| Tk { text: t, ws: String::new(), is_head: true, prespace: false, ..token.clone() })
                .collect()
        } else {
            vec![token.clone()]
        };
        if tks.is_empty() {
            continue;
        }
        let last = tks.len() - 1;
        tks[last].ws = token.ws.clone();
        let ntk = tks.len();
        for j in 0..ntk {
            let mut tk = tks[j].clone();
            if tk.alias.is_some() || tk.phonemes.is_some() {
            } else if tk.tag == "$" && ["$", "£", "€"].contains(&tk.text.as_str()) {
                currency = Some(tk.text.clone());
                tk.phonemes = Some(String::new());
            } else if tk.tag == ":" && (tk.text == "-" || tk.text == "–") {
                tk.phonemes = Some("—".into());
            } else if PUNCT_TAGS.contains(&tk.tag.as_str()) && !tk.text.chars().all(|c| lower(&c.to_string()).chars().all(|x| x.is_ascii_lowercase())) {
                tk.phonemes = Some(match tk.tag.as_str() {
                    "-LRB-" => "(".into(),
                    "-RRB-" => ")".into(),
                    "``" => "\u{201C}".into(),
                    "\"\"" | "''" => "\u{201D}".into(),
                    _ => tk.text.chars().filter(|c| PUNCTS.contains(*c)).collect(),
                });
            } else if currency.is_some() {
                if tk.tag != "CD" {
                    currency = None;
                } else if j + 1 == ntk && (i + 1 == nt || tokens[i + 1].tag != "CD") {
                    tk.currency = currency.clone();
                }
            } else if 0 < j && j < ntk - 1 && tk.text == "2" {
                let a = tks[j - 1].text.chars().last();
                let b = tks[j + 1].text.chars().next();
                if a.is_some_and(|x| x.is_alphabetic()) && b.is_some_and(|x| x.is_alphabetic()) {
                    tk.alias = Some("to".into());
                }
            }
            if tk.alias.is_some() || tk.phonemes.is_some() {
                words.push(Word::One(tk));
            } else if let Some(Word::Many(v)) = words.last_mut().filter(|w| matches!(w, Word::Many(v) if v.last().unwrap().ws.is_empty())) {
                tk.is_head = false;
                v.push(tk);
            } else if !tk.ws.is_empty() {
                words.push(Word::One(tk));
            } else {
                words.push(Word::Many(vec![tk]));
            }
        }
    }
    words
        .into_iter()
        .map(|w| match w {
            Word::Many(mut v) if v.len() == 1 => Word::One(v.pop().unwrap()),
            w => w,
        })
        .collect()
}

// ------------------------------------------------------------------ spaCy approximation

const DT: &[&str] = &["a", "an", "the", "this", "these", "those", "every", "each", "some", "any", "no", "another", "all", "both", "either", "neither"];
const PRP: &[&str] = &["i", "you", "he", "she", "it", "we", "they", "me", "him", "us", "them", "myself", "yourself", "himself", "herself", "itself", "ourselves", "themselves"];
const PRPS: &[&str] = &["my", "your", "his", "its", "our", "their"];
const IN: &[&str] = &["of", "in", "on", "at", "by", "for", "with", "from", "about", "into", "over", "under", "after", "before", "between", "through", "during", "without", "within", "than", "as", "if", "because", "while", "since", "until", "upon", "against", "among", "toward", "towards", "across", "behind", "beyond", "near", "like", "per", "via"];
const CC: &[&str] = &["and", "or", "but", "nor", "yet", "so"];
const MD: &[&str] = &["can", "could", "will", "would", "shall", "should", "may", "might", "must", "'ll", "'d", "ca", "wo"];
const WP: &[&str] = &["which", "who", "whom", "whose", "what"];
const WRB: &[&str] = &["when", "where", "why", "how"];
const UH: &[&str] = &["hi", "hello", "oh", "yes", "ok", "okay", "wow", "hey", "thanks", "please", "sorry"];
const RB: &[&str] = &["not", "n't", "never", "very", "too", "also", "just", "only", "even", "still", "already", "always", "often", "again", "here", "now", "then", "soon", "ago", "quite", "really", "rather", "almost", "later", "aloud", "finally", "completely", "once", "twice"];
const VBZ: &[&str] = &["is", "has", "does", "'s"];
const VBP: &[&str] = &["am", "are", "have", "do", "'m", "'re", "'ve"];
const VBD: &[&str] = &["was", "were", "had", "did"];
const BE_HAVE: &[&str] = &["is", "are", "was", "were", "be", "been", "being", "am", "'m", "'re", "'s", "has", "have", "had", "'ve", "get", "got"];

fn tag_word(w: &str, prevs: &[Tk], next: Option<&str>, sentence_start: bool) -> String {
    let prev = prevs.last();
    let pptag = if prevs.len() >= 2 { prevs[prevs.len() - 2].tag.as_str() } else { "" };
    let pplw = if prevs.len() >= 2 { lower(&prevs[prevs.len() - 2].text) } else { String::new() };
    let lw = lower(w);
    let lw = lw.as_str();
    let ptag = prev.map(|p| p.tag.as_str()).unwrap_or("");
    let plw = prev.map(|p| lower(&p.text)).unwrap_or_default();
    if w == "I" {
        return "PRP".into();
    }
    if lw == "to" {
        return "TO".into();
    }
    if lw == "that" {
        let nl = next.map(lower).unwrap_or_default();
        if PRP.contains(&nl.as_str()) || DT.contains(&nl.as_str()) || PRPS.contains(&nl.as_str()) {
            return "IN".into();
        }
        if ptag.starts_with("NN") {
            return "WDT".into();
        }
        return "DT".into();
    }
    if lw == "her" {
        let nl = next.map(lower).unwrap_or_default();
        let open = next.is_some_and(|n| n.chars().all(|c| c.is_alphabetic()))
            && ![DT, PRP, IN, CC, MD, RB].iter().any(|l| l.contains(&nl.as_str()));
        return if open { "PRP$".into() } else { "PRP".into() };
    }
    if lw == "there" {
        let nl = next.map(lower).unwrap_or_default();
        return if ["is", "are", "was", "were", "'s"].contains(&nl.as_str()) { "EX".into() } else { "RB".into() };
    }
    for (list, tag) in [
        (DT, "DT"),
        (PRP, "PRP"),
        (PRPS, "PRP$"),
        (IN, "IN"),
        (CC, "CC"),
        (MD, "MD"),
        (WP, "WP"),
        (WRB, "WRB"),
        (UH, "UH"),
        (RB, "RB"),
        (VBZ, "VBZ"),
        (VBP, "VBP"),
        (VBD, "VBD"),
    ] {
        if list.contains(&lw) {
            return tag.into();
        }
    }
    if lw == "be" {
        return "VB".into();
    }
    if lw == "been" {
        return "VBN".into();
    }
    if w.chars().any(|c| c.is_ascii_digit()) && w.chars().all(|c| c.is_ascii_digit() || ",.-".contains(c)) {
        return "CD".into();
    }
    let first_upper = w.chars().next().is_some_and(|c| c.is_uppercase());
    let all_caps = clen(w) > 1 && w == upper(w);
    if all_caps && w.ends_with('S') {
        return "NNS".into();
    }
    if ptag == "HYPH" {
        return "NN".into();
    }
    if first_upper && (!sentence_start || all_caps) {
        return "NNP".into();
    }
    // "of public documents": a noun after a preposition's object still belongs to the noun phrase
    let in_np = ptag == "NN" && ["IN", "JJ", "CD"].contains(&pptag);
    let after_subject = !in_np
        && (ptag == "PRP" || ptag == "NNP" || ptag == "NNS" || ptag == "WDT" || (ptag == "NN" && !plw.is_empty()));
    // "Could you read": the subject of an inverted question is followed by the bare verb
    let inverted = (ptag == "PRP" || ptag == "NNP") && (pptag == "MD" || ["do", "does", "did"].contains(&pplw.as_str()));
    let after_aux = inverted || ptag == "TO" || ptag == "MD" || plw == "n't" || plw == "not" || plw == "do" || plw == "did" || plw == "does";
    let after_have = ["have", "'ve", "has", "had"].contains(&plw.as_str());
    if after_have && lw == "read" {
        return "VBN".into();
    }
    let after_det = ["DT", "PRP$", "JJ", "IN", "POS", "CD"].contains(&ptag);
    if lw.ends_with("ly") && clen(lw) > 3 {
        return "RB".into();
    }
    if lw.ends_with("ing") && clen(lw) > 4 {
        return "VBG".into();
    }
    if lw.ends_with("ed") && clen(lw) > 3 {
        if BE_HAVE.contains(&plw.as_str()) {
            return "VBN".into();
        }
        return if after_det { "JJ".into() } else { "VBD".into() };
    }
    if after_aux {
        return "VB".into();
    }
    if after_det {
        return if lw.ends_with('s') && !lw.ends_with("ss") { "NNS".into() } else { "NN".into() };
    }
    if after_subject {
        if lw == "read" || lw == "used" {
            return "VBD".into();
        }
        return if lw.ends_with('s') && !lw.ends_with("ss") { "VBZ".into() } else { "VBP".into() };
    }
    if lw.ends_with('s') && !lw.ends_with("ss") {
        return "NNS".into();
    }
    if sentence_start {
        return "VB".into();
    }
    "NN".into()
}

const CONTRACTIONS: [&str; 7] = ["n't", "'s", "'m", "'re", "'ve", "'ll", "'d"];
const ABBREV: [&str; 12] = ["mr.", "mrs.", "ms.", "dr.", "st.", "vs.", "etc.", "e.g.", "i.e.", "jr.", "sr.", "prof."];

fn punct_tag(s: &str, opening: bool) -> Option<&'static str> {
    Some(match s {
        "." | "!" | "?" | "!?" | "?!" => ".",
        "," => ",",
        ";" | ":" | "—" | "–" | "--" | "-" | "..." | "…" => ":",
        "(" | "[" | "{" => "-LRB-",
        ")" | "]" | "}" => "-RRB-",
        "“" | "‘" => "``",
        "”" | "’" => "''",
        "\"" | "'" => {
            if opening {
                "``"
            } else {
                "''"
            }
        }
        "$" | "£" | "€" => "$",
        "#" => "#",
        "%" => "NN",
        "&" => "CC",
        "+" | "@" | "/" => "SYM",
        _ => return None,
    })
}

/// Split one whitespace-delimited chunk like spaCy's English tokenizer does for ordinary text.
fn split_chunk(chunk: &str) -> Vec<String> {
    let mut prefix: Vec<String> = Vec::new();
    let mut suffix: Vec<String> = Vec::new();
    let mut s: String = chunk.to_string();
    loop {
        let Some(f) = s.chars().next() else { break };
        if "\"“‘([{$£€#¿¡".contains(f) || (f == '\'' && s.chars().count() > 1 && !CONTRACTIONS.iter().any(|c| lower(&s) == *c)) {
            prefix.push(f.to_string());
            s = s[f.len_utf8()..].to_string();
        } else {
            break;
        }
    }
    loop {
        if s.is_empty() {
            break;
        }
        if s.ends_with("...") && s.len() > 3 {
            suffix.push("...".into());
            s.truncate(s.len() - 3);
            continue;
        }
        let l = s.chars().last().unwrap();
        if "\"”’)]}…,!?;:%".contains(l) || (l == '\'' && s.chars().count() > 1) {
            suffix.push(l.to_string());
            s.truncate(s.len() - l.len_utf8());
            continue;
        }
        if l == '.' && s.chars().count() > 1 {
            let low = lower(&s);
            let inner = &s[..s.len() - 1];
            if ABBREV.contains(&low.as_str()) || (inner.contains('.') && isalpha(&inner.replace('.', ""))) {
                break;
            }
            suffix.push(".".into());
            s.truncate(s.len() - 1);
            continue;
        }
        let low = lower(&s).replace('’', "'");
        if let Some(c) = CONTRACTIONS.iter().find(|c| low.ends_with(*c) && low.len() > c.len()) {
            let k = s.chars().count() - c.chars().count();
            let head: String = s.chars().take(k).collect();
            let tail: String = s.chars().skip(k).collect();
            suffix.push(tail);
            s = head;
            continue;
        }
        break;
    }
    let mut out = prefix;
    // infixes: hyphens / slashes between letters or digits and letters
    if !s.is_empty() {
        let c: Vec<char> = s.chars().collect();
        let mut cur = String::new();
        for i in 0..c.len() {
            let infix = (c[i] == '-' || c[i] == '/' || c[i] == '—' || c[i] == '–')
                && i > 0
                && i + 1 < c.len()
                && c[i - 1].is_alphanumeric()
                && c[i + 1].is_alphabetic();
            if infix {
                out.push(std::mem::take(&mut cur));
                out.push(c[i].to_string());
            } else {
                cur.push(c[i]);
            }
        }
        if !cur.is_empty() {
            out.push(cur);
        }
    }
    suffix.reverse();
    out.extend(suffix);
    out
}

fn tokenize(text: &str) -> Vec<Tk> {
    let mut raw: Vec<(String, String)> = Vec::new();
    let c: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < c.len() {
        if c[i].is_whitespace() {
            i += 1;
            continue;
        }
        let st = i;
        while i < c.len() && !c[i].is_whitespace() {
            i += 1;
        }
        let chunk: String = c[st..i].iter().collect();
        let ws = if i < c.len() { " " } else { "" };
        let parts = split_chunk(&chunk);
        let np = parts.len();
        for (k, p) in parts.into_iter().enumerate() {
            raw.push((p, if k + 1 == np { ws.to_string() } else { String::new() }));
        }
    }
    let mut out: Vec<Tk> = Vec::new();
    let mut sentence_start = true;
    for k in 0..raw.len() {
        let (text, ws) = &raw[k];
        let opening = k == 0 || !raw[k - 1].1.is_empty();
        let infix_hyphen = text == "-" && ws.is_empty() && k > 0 && raw[k - 1].1.is_empty();
        let tag = match punct_tag(text, opening) {
            _ if infix_hyphen => "HYPH".to_string(),
            Some(t) => t.to_string(),
            None => tag_word(text, &out, raw.get(k + 1).map(|x| x.0.as_str()), sentence_start),
        };
        let is_quote = tag == "``" || tag == "-LRB-";
        sentence_start = tag == "." || (sentence_start && is_quote);
        out.push(Tk { text: text.clone(), tag, ws: ws.clone(), is_head: true, ..Default::default() });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_words() {
        assert_eq!(cardinal_words(386).join(" "), "three hundred eighty six");
        assert_eq!(year_words(1945).join(" "), "nineteen forty five");
        assert_eq!(year_words(2005).join(" "), "two thousand five");
        assert_eq!(ordinal_words(21).join(" "), "twenty first");
    }

    #[test]
    fn subtokens() {
        assert_eq!(subtokenize("ChatGPT"), vec!["Chat", "GPT"]);
        assert_eq!(subtokenize("3.14"), vec!["3.14"]);
        assert_eq!(subtokenize("don't"), vec!["don't"]);
    }
}
