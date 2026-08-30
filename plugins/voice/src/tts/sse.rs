// Server-sent events, only as much of the spec as a TTS stream uses: `data:`
// lines, blank-line frame separator, `[DONE]` sentinel. Fed bytes as they come
// off the socket, because where the vendor chose to flush is exactly what makes
// sentence relay possible or not — a parser that waits for a whole body would
// hide it (docs/assets/tts-probe/README.md).

/// Accumulates bytes and yields whole `data:` payloads.
#[derive(Default)]
pub struct SseParser {
    buf: Vec<u8>,
}

/// What one complete SSE frame turned out to be.
#[derive(Debug, PartialEq, Eq)]
pub enum SseEvent {
    /// The joined `data:` lines of one frame.
    Data(String),
    /// `data: [DONE]`. The stream is over: whatever trails it in the same read
    /// is dropped, and the reader stops there (mimo.rs). The parser keeps no
    /// memory of it — it is the reader that stops, not this.
    Done,
}

impl SseParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Push a socket read and take whatever frames it completed. Frames only
    /// come out whole; a half-arrived one stays in the buffer.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<SseEvent> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        while let Some(frame) = self.take_frame() {
            if let Some(event) = parse_frame(&frame) {
                let done = event == SseEvent::Done;
                out.push(event);
                if done {
                    self.buf.clear();
                    break;
                }
            }
        }
        out
    }

    /// Cut off the next frame, consuming its terminator. `\r\n\r\n` is checked
    /// before `\n\n` so that a CRLF stream does not leave a stray `\r` glued to
    /// the last line of every frame.
    fn take_frame(&mut self) -> Option<Vec<u8>> {
        let (at, len) = find_separator(&self.buf)?;
        let frame = self.buf[..at].to_vec();
        self.buf.drain(..at + len);
        Some(frame)
    }
}

fn find_separator(buf: &[u8]) -> Option<(usize, usize)> {
    let mut best: Option<(usize, usize)> = None;
    if let Some(at) = find(buf, b"\r\n\r\n") {
        best = Some((at, 4));
    }
    if let Some(at) = find(buf, b"\n\n") {
        best = match best {
            Some((prev, len)) if prev <= at => Some((prev, len)),
            _ => Some((at, 2)),
        };
    }
    best
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|w| w == needle)
}

fn parse_frame(frame: &[u8]) -> Option<SseEvent> {
    let text = String::from_utf8_lossy(frame);
    let mut data = String::new();
    for line in text.lines() {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let Some(rest) = line.strip_prefix("data:") else {
            // `event:`, `id:`, `retry:` and comment lines are not used by either
            // vendor; dropping them keeps this from growing a state machine it
            // has no reader for.
            continue;
        };
        let rest = rest.strip_prefix(' ').unwrap_or(rest);
        if !data.is_empty() {
            data.push('\n');
        }
        data.push_str(rest);
    }
    if data.is_empty() {
        return None;
    }
    if data.trim() == "[DONE]" {
        return Some(SseEvent::Done);
    }
    Some(SseEvent::Data(data))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_frame_split_across_reads_comes_out_once_and_whole() {
        let mut p = SseParser::new();
        assert!(p.push(b"data: {\"a\":").is_empty());
        assert!(p.push(b"1}").is_empty());
        assert_eq!(
            p.push(b"\n\n"),
            vec![SseEvent::Data("{\"a\":1}".to_string())]
        );
    }

    #[test]
    fn several_frames_in_one_read_all_come_out() {
        let mut p = SseParser::new();
        let events = p.push(b"data: one\n\ndata: two\n\n");
        assert_eq!(
            events,
            vec![
                SseEvent::Data("one".to_string()),
                SseEvent::Data("two".to_string())
            ]
        );
    }

    #[test]
    fn crlf_does_not_leak_into_the_payload() {
        let mut p = SseParser::new();
        assert_eq!(
            p.push(b"data: {\"a\":1}\r\n\r\n"),
            vec![SseEvent::Data("{\"a\":1}".to_string())]
        );
    }

    #[test]
    fn done_ends_the_stream_and_drops_whatever_trails_it() {
        let mut p = SseParser::new();
        let events = p.push(b"data: [DONE]\n\ndata: late\n\n");
        assert_eq!(events, vec![SseEvent::Done]);
        // Only what was in that read. The parser holds no "over" flag and the
        // reader is what stops: it breaks out of the loop on this event and
        // never pushes again (mimo.rs).
        assert_eq!(
            p.push(b"data: later\n\n"),
            vec![SseEvent::Data("later".to_string())]
        );
    }

    #[test]
    fn multi_line_data_is_joined_with_newlines() {
        let mut p = SseParser::new();
        assert_eq!(
            p.push(b"data: a\ndata: b\n\n"),
            vec![SseEvent::Data("a\nb".to_string())]
        );
    }

    #[test]
    fn comment_and_event_lines_are_dropped() {
        let mut p = SseParser::new();
        assert_eq!(
            p.push(b": ping\nevent: message\ndata: x\n\n"),
            vec![SseEvent::Data("x".to_string())]
        );
    }
}
