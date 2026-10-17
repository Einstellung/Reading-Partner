//! `cn2an.transform(text, "an2cn")` from cn2an 0.5.24 (MIT), which is how misaki's ZHG2P reads numbers:
//! ranges before measure words, dates, fractions, percentages, degrees Celsius, then every remaining number.
//! The regexes are hand-matched; digits are ASCII only.

const MEASURE_WORDS: [&str; 33] = [
    "斤", "克", "千克", "公斤", "吨", "米", "厘米", "毫米", "公里", "升", "毫升", "元", "角", "分", "个", "只", "条",
    "张", "块", "瓶", "杯", "份", "本", "辆", "台", "匹", "头", "位", "亩", "小时", "分钟", "秒", "天",
];
const NUM_LOW: [char; 10] = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const UNIT_LOW: [&str; 16] = ["", "十", "百", "千", "万", "十", "百", "千", "亿", "十", "百", "千", "万", "十", "百", "千"];

fn starts_measure(c: &[char], i: usize) -> bool {
    // The original also lists 半, but only as an alternative of the same group.
    MEASURE_WORDS.iter().chain(["半"].iter()).any(|w| {
        let wc: Vec<char> = w.chars().collect();
        c.len() >= i + wc.len() && c[i..i + wc.len()] == wc[..]
    })
}

fn dig(c: &[char], i: usize) -> usize {
    let mut j = i;
    while j < c.len() && c[j].is_ascii_digit() {
        j += 1;
    }
    j
}

fn integer_convert(d: &str) -> Option<String> {
    let d = d.trim_start_matches('0');
    let d = if d.is_empty() { "0" } else { d };
    let n = d.len();
    if n > UNIT_LOW.len() {
        return None;
    }
    let mut out = String::new();
    for (i, ch) in d.chars().enumerate() {
        let v = ch.to_digit(10).unwrap() as usize;
        if v != 0 {
            out.push(NUM_LOW[v]);
            out.push_str(UNIT_LOW[n - i - 1]);
        } else {
            if (n - i - 1) % 4 == 0 {
                out.push(NUM_LOW[0]);
                out.push_str(UNIT_LOW[n - i - 1]);
            }
            if i > 0 && !out.ends_with('零') {
                out.push(NUM_LOW[0]);
            }
        }
    }
    let mut out = out.replace("零零", "零").replace("零万", "万").replace("零亿", "亿").replace("亿万", "亿");
    out = out.trim_matches('零').to_string();
    // ([万亿])零([一二三四五六七八九壹贰叁肆伍陆柒捌玖][千仟]) -> \1\2
    let c: Vec<char> = out.chars().collect();
    let mut r = String::new();
    let mut i = 0;
    while i < c.len() {
        if (c[i] == '万' || c[i] == '亿')
            && c.get(i + 1) == Some(&'零')
            && c.get(i + 2).is_some_and(|x| "一二三四五六七八九壹贰叁肆伍陆柒捌玖".contains(*x))
            && c.get(i + 3).is_some_and(|x| *x == '千' || *x == '仟')
        {
            r.push(c[i]);
            r.push(c[i + 2]);
            r.push(c[i + 3]);
            i += 4;
            continue;
        }
        r.push(c[i]);
        i += 1;
    }
    let mut out = r;
    if out.starts_with("一十") {
        out = out.chars().skip(1).collect();
    }
    if out.is_empty() {
        out = "零".into();
    }
    Some(out)
}

/// An2Cn.an2cn(inputs, "low"); None where cn2an raises (and transform then keeps the input).
fn an2cn_low(s: &str) -> Option<String> {
    if s.is_empty() || !s.chars().all(|c| c.is_ascii_digit() || c == '.' || c == '-') {
        return None;
    }
    let (sign, s) = match s.strip_prefix('-') {
        Some(r) => ("负", r),
        None => ("", s),
    };
    let parts: Vec<&str> = s.split('.').collect();
    let out = match parts.len() {
        1 => integer_convert(parts[0])?,
        2 => {
            if parts[0].is_empty() || !parts[0].chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            let mut o = integer_convert(parts[0])?;
            let dec: String = parts[1].chars().take(16).collect();
            if !dec.is_empty() {
                o.push('点');
            }
            for ch in dec.chars() {
                o.push(NUM_LOW[ch.to_digit(10)? as usize]);
            }
            o
        }
        _ => return None,
    };
    Some(format!("{sign}{out}"))
}

fn an2cn_direct(s: &str) -> String {
    s.chars()
        .map(|c| if c == '.' { '点' } else { NUM_LOW[c.to_digit(10).unwrap_or(0) as usize] })
        .collect()
}

fn low_or_keep(s: &str) -> String {
    an2cn_low(s).unwrap_or_else(|| s.to_string())
}

/// Generic left-to-right `re.sub` driver: `m(c, i)` returns the end of a match starting at i.
fn sub(text: &str, m: impl Fn(&[char], usize) -> Option<usize>, f: impl Fn(&str) -> String) -> String {
    let c: Vec<char> = text.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < c.len() {
        match m(&c, i) {
            Some(e) if e > i => {
                let s: String = c[i..e].iter().collect();
                out.push_str(&f(&s));
                i = e;
            }
            _ => {
                out.push(c[i]);
                i += 1;
            }
        }
    }
    out
}

/// -?(\d+\.)?\d+ starting at i (with or without the leading minus as allowed by `minus`).
fn number_at(c: &[char], i: usize, minus: bool) -> Option<usize> {
    let mut j = i;
    if minus && j < c.len() && c[j] == '-' {
        j += 1;
    }
    let a = dig(c, j);
    if a == j {
        return None;
    }
    if a < c.len() && c[a] == '.' {
        let b = dig(c, a + 1);
        if b > a + 1 {
            return Some(b);
        }
    }
    Some(a)
}

pub fn an2cn_transform(text: &str) -> String {
    // \d+(\.\d+)?-\d+(\.\d+)?(?=measure)
    let s = sub(
        text,
        |c, i| {
            let e1 = number_at(c, i, false)?;
            if e1 >= c.len() || c[e1] != '-' {
                return None;
            }
            let e2 = number_at(c, e1 + 1, false)?;
            if starts_measure(c, e2) {
                return Some(e2);
            }
            // backtrack the optional fraction of the second number
            let e2b = dig(c, e1 + 1);
            if e2b != e2 && starts_measure(c, e2b) {
                return Some(e2b);
            }
            None
        },
        |m| {
            let (a, b) = m.split_once('-').unwrap();
            match (an2cn_low(a), an2cn_low(b)) {
                (Some(x), Some(y)) => format!("{x}到{y}"),
                _ => m.to_string(),
            }
        },
    );
    // (\d{2,4}年)?(\d{1,2}月)?(\d{1,2}日)?
    let s = sub(
        &s,
        |c, i| {
            let mut j = i;
            let e = dig(c, j);
            if (2..=4).contains(&(e - j)) && e < c.len() && c[e] == '年' {
                j = e + 1;
            }
            let e = dig(c, j);
            if (1..=2).contains(&(e - j)) && e < c.len() && c[e] == '月' {
                j = e + 1;
            }
            let e = dig(c, j);
            if (1..=2).contains(&(e - j)) && e < c.len() && c[e] == '日' {
                j = e + 1;
            }
            Some(j)
        },
        |m| {
            let c: Vec<char> = m.chars().collect();
            let mut out = String::new();
            let mut i = 0;
            while i < c.len() {
                if c[i].is_ascii_digit() {
                    let e = dig(&c, i);
                    let d: String = c[i..e].iter().collect();
                    if e < c.len() && c[e] == '年' {
                        out.push_str(&an2cn_direct(&d));
                    } else {
                        out.push_str(&low_or_keep(&d));
                    }
                    i = e;
                } else {
                    out.push(c[i]);
                    i += 1;
                }
            }
            out
        },
    );
    // \d+/\d+
    let s = sub(
        &s,
        |c, i| {
            let e = dig(c, i);
            if e == i || e >= c.len() || c[e] != '/' {
                return None;
            }
            let e2 = dig(c, e + 1);
            (e2 > e + 1).then_some(e2)
        },
        |m| {
            let (a, b) = m.split_once('/').unwrap();
            format!("{}分之{}", low_or_keep(b), low_or_keep(a))
        },
    );
    // -?(\d+\.)?\d+%
    let s = sub(
        &s,
        |c, i| {
            let e = number_at(c, i, true)?;
            if e < c.len() && c[e] == '%' {
                return Some(e + 1);
            }
            None
        },
        |m| format!("百分之{}", low_or_keep(&m[..m.len() - 1])),
    );
    // \d+℃
    let s = sub(
        &s,
        |c, i| {
            let e = dig(c, i);
            (e > i && e < c.len() && c[e] == '℃').then_some(e + 1)
        },
        |m| format!("{}摄氏度", low_or_keep(m.trim_end_matches('℃'))),
    );
    // -?(\d+\.)?\d+
    sub(&s, |c, i| number_at(c, i, true), low_or_keep)
}

#[cfg(test)]
mod tests {
    use super::an2cn_transform as t;

    #[test]
    fn numbers() {
        assert_eq!(t("2026年10月17日"), "二零二六年十月十七日");
        assert_eq!(t("第3.5章"), "第三点五章");
        assert_eq!(t("45分钟"), "四十五分钟");
        assert_eq!(t("65%"), "百分之六十五");
        assert_eq!(t("3-5公里"), "三到五公里");
        assert_eq!(t("2/3"), "三分之二");
        assert_eq!(t("28℃"), "二十八摄氏度");
        assert_eq!(t("100000"), "十万");
        assert_eq!(t("1203"), "一千二百零三");
        assert_eq!(t("-5度"), "负五度");
    }
}
