//! A port of the parts of jieba 0.42.1 (MIT) misaki uses: `posseg.lcut` with HMM and `cut_for_search`.
//! Behaviour follows jieba/__init__.py, jieba/finalseg and jieba/posseg line by line, including tie-breaking
//! (Python's `max` over `(prob, state)` tuples prefers the larger state on equal probability).

use super::util::{chars, substr, CharMap, Reader, StrTable};

const MIN_FLOAT: f64 = -3.14e100;

pub struct Jieba {
    words: StrTable,
    freq: Vec<u32>,
    tag: Vec<u8>,
    tags: Vec<String>,
    log_total: f64,
    fs_start: [f64; 4],
    fs_trans: [[f64; 4]; 4],
    fs_emit: [CharMap<f64>; 4],
    ps: PosHmm,
}

struct PosHmm {
    /// (BMES letter, tag) sorted like Python tuples.
    states: Vec<(char, String)>,
    all_states: Vec<u16>,
    start: Vec<f64>,
    trans: Vec<Vec<(u16, f64)>>,
    emit: Vec<CharMap<f64>>,
    char_states: CharMap<u32>,
    char_state_lists: Vec<Vec<u16>>,
}

const BMES: [char; 4] = ['B', 'M', 'E', 'S'];

fn is_han_detail(c: char) -> bool {
    ('\u{4E00}'..='\u{9FD5}').contains(&c)
}

fn is_han_internal(c: char) -> bool {
    is_han_detail(c) || c.is_ascii_alphanumeric() || "+#&._".contains(c)
}

fn is_han_default(c: char) -> bool {
    is_han_internal(c) || c == '%' || c == '-'
}

/// Runs of characters that do / do not satisfy `pred`, in order.
fn runs(s: &[char], pred: impl Fn(char) -> bool) -> Vec<(bool, String)> {
    let mut out: Vec<(bool, String)> = Vec::new();
    for &c in s {
        let p = pred(c);
        match out.last_mut() {
            Some((q, buf)) if *q == p => buf.push(c),
            _ => out.push((p, c.to_string())),
        }
    }
    out
}

/// `re.split("(\r\n|\s)", x)` without the empty pieces: whitespace items come one by one.
fn skip_split(s: &str) -> Vec<(bool, String)> {
    let c = chars(s);
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut i = 0;
    while i < c.len() {
        if c[i] == '\r' && i + 1 < c.len() && c[i + 1] == '\n' {
            if !buf.is_empty() {
                out.push((false, std::mem::take(&mut buf)));
            }
            out.push((true, "\r\n".to_string()));
            i += 2;
            continue;
        }
        if super::util::py_space(c[i]) {
            if !buf.is_empty() {
                out.push((false, std::mem::take(&mut buf)));
            }
            out.push((true, c[i].to_string()));
        } else {
            buf.push(c[i]);
        }
        i += 1;
    }
    if !buf.is_empty() {
        out.push((false, buf));
    }
    out
}

impl Jieba {
    pub fn load(r: &mut Reader) -> Jieba {
        let total = r.u64();
        let ntags = r.u8() as usize;
        let tags: Vec<String> = (0..ntags).map(|_| r.s().to_string()).collect();
        let n = r.u32() as usize;
        let mut words = StrTable::default();
        let mut freq = Vec::with_capacity(n);
        let mut tag = Vec::with_capacity(n);
        for _ in 0..n {
            words.push(r.s());
            freq.push(r.u32());
            tag.push(r.u8());
        }
        words.finish();
        let mut fs_start = [0.0; 4];
        for v in fs_start.iter_mut() {
            *v = r.f64();
        }
        let mut fs_trans = [[0.0; 4]; 4];
        for row in fs_trans.iter_mut() {
            for v in row.iter_mut() {
                *v = r.f64();
            }
        }
        let fs_emit = [(); 4].map(|_| {
            let n = r.u32();
            let mut m = CharMap::new();
            for _ in 0..n {
                let k = r.u32();
                m.push(k, r.f64());
            }
            m
        });
        let ns = r.u16() as usize;
        let mut states = Vec::with_capacity(ns);
        let mut all_states = Vec::new();
        for i in 0..ns {
            let b = r.u8() as char;
            let t = r.s().to_string();
            if r.u8() == 1 {
                all_states.push(i as u16);
            }
            states.push((b, t));
        }
        let start: Vec<f64> = (0..ns).map(|_| r.f64()).collect();
        let trans: Vec<Vec<(u16, f64)>> = (0..ns)
            .map(|_| {
                let k = r.u16();
                (0..k)
                    .map(|_| {
                        let y = r.u16();
                        (y, r.f64())
                    })
                    .collect()
            })
            .collect();
        let emit: Vec<CharMap<f64>> = (0..ns)
            .map(|_| {
                let k = r.u32();
                let mut m = CharMap::new();
                for _ in 0..k {
                    let c = r.u32();
                    m.push(c, r.f64());
                }
                m
            })
            .collect();
        let nc = r.u32();
        let mut char_states = CharMap::new();
        let mut char_state_lists = Vec::with_capacity(nc as usize);
        for i in 0..nc {
            let c = r.u32();
            let k = r.u16();
            char_state_lists.push((0..k).map(|_| r.u16()).collect());
            char_states.push(c, i);
        }
        Jieba {
            words,
            freq,
            tag,
            tags,
            log_total: (total as f64).ln(),
            fs_start,
            fs_trans,
            fs_emit,
            ps: PosHmm { states, all_states, start, trans, emit, char_states, char_state_lists },
        }
    }

    /// FREQ.get(w): None when absent (prefixes count as present with 0).
    fn freq_of(&self, w: &str) -> Option<u32> {
        if let Some(i) = self.words.find(w) {
            return Some(self.freq[i]);
        }
        if self.words.has_prefix(w) {
            return Some(0);
        }
        None
    }

    /// FREQ.get(w) truthiness.
    pub fn has_word(&self, w: &str) -> bool {
        self.freq_of(w).unwrap_or(0) > 0
    }

    fn word_tag(&self, w: &str) -> String {
        match self.words.find(w) {
            Some(i) => self.tags[self.tag[i] as usize].clone(),
            None => "x".to_string(),
        }
    }

    fn route(&self, s: &[char]) -> Vec<usize> {
        let n = s.len();
        let mut dag: Vec<Vec<usize>> = Vec::with_capacity(n);
        for k in 0..n {
            let mut tmp = Vec::new();
            let mut i = k;
            let mut frag = s[k].to_string();
            while i < n {
                match self.freq_of(&frag) {
                    Some(f) => {
                        if f > 0 {
                            tmp.push(i);
                        }
                    }
                    None => break,
                }
                i += 1;
                if i < n {
                    frag.push(s[i]);
                }
            }
            if tmp.is_empty() {
                tmp.push(k);
            }
            dag.push(tmp);
        }
        let mut route: Vec<(f64, usize)> = vec![(0.0, 0); n + 1];
        for idx in (0..n).rev() {
            let mut best: Option<(f64, usize)> = None;
            for &x in &dag[idx] {
                let w = substr(s, idx, x + 1);
                let f = match self.freq_of(&w) {
                    Some(f) if f > 0 => f,
                    _ => 1,
                };
                let p = (f as f64).ln() - self.log_total + route[x + 1].0;
                let cand = (p, x);
                best = Some(match best {
                    None => cand,
                    Some(b) => {
                        if cand.0 > b.0 || (cand.0 == b.0 && cand.1 > b.1) {
                            cand
                        } else {
                            b
                        }
                    }
                });
            }
            route[idx] = best.unwrap();
        }
        route.iter().map(|r| r.1).collect()
    }

    // ------------------------------------------------------------- jieba.cut (HMM=True)

    fn finalseg_viterbi(&self, obs: &[char]) -> Vec<usize> {
        // PrevStatus = {'B': 'ES', 'M': 'MB', 'S': 'SE', 'E': 'BM'}; indices B0 M1 E2 S3
        const PREV: [[usize; 2]; 4] = [[2, 3], [1, 0], [0, 1], [3, 2]];
        let n = obs.len();
        let mut v = vec![[0f64; 4]; n];
        let mut path: Vec<Vec<usize>> = (0..4).map(|y| vec![y]).collect();
        for y in 0..4 {
            v[0][y] = self.fs_start[y] + self.fs_emit[y].get(obs[0]).unwrap_or(MIN_FLOAT);
        }
        for t in 1..n {
            let mut newpath = Vec::with_capacity(4);
            for y in 0..4 {
                let em = self.fs_emit[y].get(obs[t]).unwrap_or(MIN_FLOAT);
                let mut best: Option<(f64, usize)> = None;
                for &y0 in &PREV[y] {
                    let p = v[t - 1][y0] + self.fs_trans[y0][y] + em;
                    best = Some(match best {
                        None => (p, y0),
                        Some(b) => {
                            if p > b.0 || (p == b.0 && BMES[y0] > BMES[b.1]) {
                                (p, y0)
                            } else {
                                b
                            }
                        }
                    });
                }
                let (p, st) = best.unwrap();
                v[t][y] = p;
                let mut np = path[st].clone();
                np.push(y);
                newpath.push(np);
            }
            path = newpath;
        }
        // max over 'ES' -> E=2, S=3
        let (e, s) = (v[n - 1][2], v[n - 1][3]);
        let last = if s > e || s == e { 3 } else { 2 };
        path[last].clone()
    }

    fn finalseg_cut(&self, sentence: &str, out: &mut Vec<String>) {
        let c = chars(sentence);
        for (han, blk) in runs(&c, is_han_detail) {
            if han {
                let bc = chars(&blk);
                let pos = self.finalseg_viterbi(&bc);
                let (mut begin, mut nexti) = (0, 0);
                for (i, &p) in pos.iter().enumerate() {
                    match p {
                        0 => begin = i,
                        2 => {
                            out.push(substr(&bc, begin, i + 1));
                            nexti = i + 1;
                        }
                        3 => {
                            out.push(bc[i].to_string());
                            nexti = i + 1;
                        }
                        _ => {}
                    }
                }
                if nexti < bc.len() {
                    out.push(substr(&bc, nexti, bc.len()));
                }
            } else {
                // re_skip = ([a-zA-Z0-9]+(?:\.\d+)?%?)
                let bc = chars(&blk);
                let mut i = 0;
                let mut other = String::new();
                while i < bc.len() {
                    if bc[i].is_ascii_alphanumeric() {
                        if !other.is_empty() {
                            out.push(std::mem::take(&mut other));
                        }
                        let st = i;
                        while i < bc.len() && bc[i].is_ascii_alphanumeric() {
                            i += 1;
                        }
                        if i + 1 < bc.len() && bc[i] == '.' && bc[i + 1].is_ascii_digit() {
                            i += 1;
                            while i < bc.len() && bc[i].is_ascii_digit() {
                                i += 1;
                            }
                        }
                        if i < bc.len() && bc[i] == '%' {
                            i += 1;
                        }
                        out.push(substr(&bc, st, i));
                    } else {
                        other.push(bc[i]);
                        i += 1;
                    }
                }
                if !other.is_empty() {
                    out.push(other);
                }
            }
        }
    }

    fn flush_buf(&self, buf: &mut String, out: &mut Vec<String>) {
        if buf.is_empty() {
            return;
        }
        if buf.chars().count() == 1 {
            out.push(std::mem::take(buf));
            return;
        }
        if !self.has_word(buf) {
            let b = std::mem::take(buf);
            self.finalseg_cut(&b, out);
        } else {
            for ch in buf.chars() {
                out.push(ch.to_string());
            }
            buf.clear();
        }
    }

    fn cut_dag(&self, s: &[char], out: &mut Vec<String>) {
        let route = self.route(s);
        let n = s.len();
        let mut x = 0;
        let mut buf = String::new();
        while x < n {
            let y = route[x] + 1;
            if y - x == 1 {
                buf.push(s[x]);
            } else {
                self.flush_buf(&mut buf, out);
                out.push(substr(s, x, y));
            }
            x = y;
        }
        self.flush_buf(&mut buf, out);
    }

    pub fn cut(&self, sentence: &str) -> Vec<String> {
        let c = chars(sentence);
        let mut out = Vec::new();
        for (han, blk) in runs(&c, is_han_default) {
            if han {
                self.cut_dag(&chars(&blk), &mut out);
            } else {
                for (sp, x) in skip_split(&blk) {
                    if sp {
                        out.push(x);
                    } else {
                        for ch in x.chars() {
                            out.push(ch.to_string());
                        }
                    }
                }
            }
        }
        out
    }

    pub fn cut_for_search(&self, sentence: &str) -> Vec<String> {
        let mut out = Vec::new();
        for w in self.cut(sentence) {
            let c = chars(&w);
            if c.len() > 2 {
                for i in 0..c.len() - 1 {
                    let g = substr(&c, i, i + 2);
                    if self.has_word(&g) {
                        out.push(g);
                    }
                }
            }
            if c.len() > 3 {
                for i in 0..c.len() - 2 {
                    let g = substr(&c, i, i + 3);
                    if self.has_word(&g) {
                        out.push(g);
                    }
                }
            }
            out.push(w);
        }
        out
    }

    // ------------------------------------------------------------- jieba.posseg.lcut (HMM=True)

    fn pos_viterbi(&self, obs: &[char]) -> Vec<u16> {
        let h = &self.ps;
        let n = obs.len();
        let states_for = |c: char| -> &[u16] {
            match h.char_states.get(c) {
                Some(i) => &h.char_state_lists[i as usize],
                None => &h.all_states,
            }
        };
        let ns = h.states.len();
        // V[t] and mem_path[t] as dense arrays plus the list of present keys
        let mut v: Vec<Vec<f64>> = Vec::with_capacity(n);
        let mut mem: Vec<Vec<i32>> = Vec::with_capacity(n);
        let mut keys: Vec<Vec<u16>> = Vec::with_capacity(n);
        let mut v0 = vec![f64::NAN; ns];
        let mut m0 = vec![-1i32; ns];
        let mut k0 = Vec::new();
        for &y in states_for(obs[0]) {
            let yi = y as usize;
            if m0[yi] == -1 {
                k0.push(y);
            }
            v0[yi] = h.start[yi] + h.emit[yi].get(obs[0]).unwrap_or(MIN_FLOAT);
            m0[yi] = -2; // '' path marker
        }
        v.push(v0);
        mem.push(m0);
        keys.push(k0);
        for t in 1..n {
            let prev_states: Vec<u16> =
                keys[t - 1].iter().copied().filter(|&x| !h.trans[x as usize].is_empty()).collect();
            let mut expect = vec![false; ns];
            let mut any_expect = false;
            for &x in &prev_states {
                for &(y, _) in &h.trans[x as usize] {
                    expect[y as usize] = true;
                    any_expect = true;
                }
            }
            let mut obs_states: Vec<u16> =
                states_for(obs[t]).iter().copied().filter(|&y| expect[y as usize]).collect();
            obs_states.sort_unstable();
            obs_states.dedup();
            if obs_states.is_empty() {
                obs_states = if any_expect {
                    (0..ns as u16).filter(|&y| expect[y as usize]).collect()
                } else {
                    h.all_states.clone()
                };
            }
            let mut vt = vec![f64::NAN; ns];
            let mut mt = vec![-1i32; ns];
            let mut kt = Vec::new();
            for &y in &obs_states {
                let yi = y as usize;
                let em = h.emit[yi].get(obs[t]).unwrap_or(MIN_FLOAT);
                let mut best: Option<(f64, u16)> = None;
                for &y0 in &prev_states {
                    let tr = h.trans[y0 as usize]
                        .binary_search_by_key(&y, |e| e.0)
                        .map(|i| h.trans[y0 as usize][i].1)
                        .unwrap_or(f64::NEG_INFINITY);
                    let p = v[t - 1][y0 as usize] + tr + em;
                    best = Some(match best {
                        None => (p, y0),
                        Some(b) => {
                            if p > b.0 || (p == b.0 && y0 > b.1) {
                                (p, y0)
                            } else {
                                b
                            }
                        }
                    });
                }
                let (p, st) = best.unwrap();
                if mt[yi] == -1 {
                    kt.push(y);
                }
                vt[yi] = p;
                mt[yi] = st as i32;
            }
            v.push(vt);
            mem.push(mt);
            keys.push(kt);
        }
        let mut best: Option<(f64, u16)> = None;
        for &y in &keys[n - 1] {
            let p = v[n - 1][y as usize];
            best = Some(match best {
                None => (p, y),
                Some(b) => {
                    if p > b.0 || (p == b.0 && y > b.1) {
                        (p, y)
                    } else {
                        b
                    }
                }
            });
        }
        let mut state = best.unwrap().1;
        let mut route = vec![0u16; n];
        for i in (0..n).rev() {
            route[i] = state;
            let m = mem[i][state as usize];
            if m >= 0 {
                state = m as u16;
            }
        }
        route
    }

    fn pos_cut_han(&self, s: &[char], out: &mut Vec<(String, String)>) {
        let route = self.pos_viterbi(s);
        let (mut begin, mut nexti) = (0, 0);
        for i in 0..s.len() {
            let (b, ref t) = self.ps.states[route[i] as usize];
            match b {
                'B' => begin = i,
                'E' => {
                    out.push((substr(s, begin, i + 1), t.clone()));
                    nexti = i + 1;
                }
                'S' => {
                    out.push((s[i].to_string(), t.clone()));
                    nexti = i + 1;
                }
                _ => {}
            }
        }
        if nexti < s.len() {
            let t = self.ps.states[route[nexti] as usize].1.clone();
            out.push((substr(s, nexti, s.len()), t));
        }
    }

    fn pos_cut_detail(&self, sentence: &str, out: &mut Vec<(String, String)>) {
        let c = chars(sentence);
        for (han, blk) in runs(&c, is_han_detail) {
            if han {
                self.pos_cut_han(&chars(&blk), out);
                continue;
            }
            // re_skip_detail = ([\.0-9]+|[a-zA-Z0-9]+)
            let bc = chars(&blk);
            let mut i = 0;
            let mut other = String::new();
            while i < bc.len() {
                let c0 = bc[i];
                let st = i;
                if c0 == '.' || c0.is_ascii_digit() {
                    while i < bc.len() && (bc[i] == '.' || bc[i].is_ascii_digit()) {
                        i += 1;
                    }
                } else if c0.is_ascii_alphabetic() {
                    while i < bc.len() && bc[i].is_ascii_alphanumeric() {
                        i += 1;
                    }
                } else {
                    other.push(c0);
                    i += 1;
                    continue;
                }
                if !other.is_empty() {
                    out.push((std::mem::take(&mut other), "x".into()));
                }
                let x = substr(&bc, st, i);
                let tag = if c0 == '.' || c0.is_ascii_digit() { "m" } else { "eng" };
                out.push((x, tag.into()));
            }
            if !other.is_empty() {
                out.push((other, "x".into()));
            }
        }
    }

    fn pos_flush(&self, buf: &mut String, out: &mut Vec<(String, String)>) {
        if buf.is_empty() {
            return;
        }
        let b = std::mem::take(buf);
        if b.chars().count() == 1 {
            let t = self.word_tag(&b);
            out.push((b, t));
        } else if !self.has_word(&b) {
            self.pos_cut_detail(&b, out);
        } else {
            for ch in b.chars() {
                let w = ch.to_string();
                let t = self.word_tag(&w);
                out.push((w, t));
            }
        }
    }

    pub fn pos_cut(&self, sentence: &str) -> Vec<(String, String)> {
        let c = chars(sentence);
        let mut out = Vec::new();
        for (han, blk) in runs(&c, is_han_internal) {
            if han {
                let s = chars(&blk);
                let route = self.route(&s);
                let n = s.len();
                let mut x = 0;
                let mut buf = String::new();
                while x < n {
                    let y = route[x] + 1;
                    if y - x == 1 {
                        buf.push(s[x]);
                    } else {
                        self.pos_flush(&mut buf, &mut out);
                        let w = substr(&s, x, y);
                        let t = self.word_tag(&w);
                        out.push((w, t));
                    }
                    x = y;
                }
                self.pos_flush(&mut buf, &mut out);
            } else {
                for (sp, x) in skip_split(&blk) {
                    if sp {
                        out.push((x, "x".into()));
                    } else {
                        let eng = x.chars().next().is_some_and(|c| c.is_ascii_alphanumeric());
                        for xx in x.chars() {
                            let t = if xx == '.' || xx.is_ascii_digit() {
                                "m"
                            } else if eng {
                                "eng"
                            } else {
                                "x"
                            };
                            out.push((xx.to_string(), t.into()));
                        }
                    }
                }
            }
        }
        out
    }
}
