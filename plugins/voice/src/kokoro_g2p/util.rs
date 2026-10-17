//! Binary reader for the exported dictionaries and a few helpers that mirror Python semantics.

pub struct Reader<'a> {
    b: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    pub fn new(b: &'a [u8]) -> Self {
        Reader { b, pos: 0 }
    }
    pub fn magic(&mut self, m: &[u8]) {
        assert_eq!(&self.b[self.pos..self.pos + m.len()], m, "bad kokoro_g2p data magic");
        self.pos += m.len();
    }
    fn take(&mut self, n: usize) -> &'a [u8] {
        let s = &self.b[self.pos..self.pos + n];
        self.pos += n;
        s
    }
    pub fn u8(&mut self) -> u8 {
        self.take(1)[0]
    }
    pub fn u16(&mut self) -> u16 {
        u16::from_le_bytes(self.take(2).try_into().unwrap())
    }
    pub fn u32(&mut self) -> u32 {
        u32::from_le_bytes(self.take(4).try_into().unwrap())
    }
    pub fn u64(&mut self) -> u64 {
        u64::from_le_bytes(self.take(8).try_into().unwrap())
    }
    pub fn f64(&mut self) -> f64 {
        f64::from_le_bytes(self.take(8).try_into().unwrap())
    }
    pub fn s(&mut self) -> &'a str {
        let mut n = self.u8() as usize;
        if n == 255 {
            n = self.u16() as usize;
        }
        std::str::from_utf8(self.take(n)).expect("utf8")
    }
}

/// Sorted string table in one arena; Rust's byte order on UTF-8 equals Python's code point order.
#[derive(Default)]
pub struct StrTable {
    arena: String,
    offs: Vec<u32>,
}

impl StrTable {
    /// Strings must be pushed in sorted order.
    pub fn push(&mut self, s: &str) {
        self.offs.push(self.arena.len() as u32);
        self.arena.push_str(s);
    }
    pub fn finish(&mut self) {
        self.offs.push(self.arena.len() as u32);
    }
    pub fn len(&self) -> usize {
        self.offs.len().saturating_sub(1)
    }
    pub fn get(&self, i: usize) -> &str {
        &self.arena[self.offs[i] as usize..self.offs[i + 1] as usize]
    }
    fn lower_bound(&self, key: &str) -> usize {
        let (mut lo, mut hi) = (0, self.len());
        while lo < hi {
            let mid = (lo + hi) / 2;
            if self.get(mid) < key {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        lo
    }
    pub fn find(&self, key: &str) -> Option<usize> {
        let i = self.lower_bound(key);
        (i < self.len() && self.get(i) == key).then_some(i)
    }
    /// True when some entry starts with `key` (the entry itself counts).
    pub fn has_prefix(&self, key: &str) -> bool {
        let i = self.lower_bound(key);
        i < self.len() && self.get(i).starts_with(key)
    }
}

/// Sorted (code point -> value) table.
pub struct CharMap<T: Copy> {
    keys: Vec<u32>,
    vals: Vec<T>,
}

impl<T: Copy> CharMap<T> {
    pub fn new() -> Self {
        CharMap { keys: Vec::new(), vals: Vec::new() }
    }
    pub fn push(&mut self, k: u32, v: T) {
        self.keys.push(k);
        self.vals.push(v);
    }
    pub fn get(&self, c: char) -> Option<T> {
        self.keys.binary_search(&(c as u32)).ok().map(|i| self.vals[i])
    }
}

pub fn chars(s: &str) -> Vec<char> {
    s.chars().collect()
}

pub fn substr(c: &[char], a: usize, b: usize) -> String {
    c[a..b].iter().collect()
}

/// Python's `s[:-1] + t` on a tone-numbered final.
pub fn retone(f: &str, t: char) -> String {
    let mut s: String = f.to_string();
    s.pop();
    s.push(t);
    s
}

pub fn last_char(s: &str) -> Option<char> {
    s.chars().last()
}

/// Python str.isspace for a non-empty string.
pub fn py_isspace(s: &str) -> bool {
    !s.is_empty() && s.chars().all(py_space)
}

pub fn py_space(c: char) -> bool {
    c.is_whitespace() || ('\x1c'..='\x1f').contains(&c)
}

/// Python str.strip() with no arguments.
pub fn py_strip(s: &str) -> &str {
    s.trim_matches(py_space)
}

