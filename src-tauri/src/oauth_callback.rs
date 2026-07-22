// One-shot loopback HTTP listener for an OAuth redirect. Started from the
// frontend right before the system browser is opened; blocks until the matching
// redirect arrives, returns the authorization code to the frontend, and shuts
// the listener down. The port and callback path are parameterized because each
// provider registers a different redirect URI: Anthropic and Google share
// localhost:53692/callback, OpenAI (ChatGPT) uses localhost:1455/auth/callback.
// std only.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::time::{Duration, Instant};

const TIMEOUT_SECS: u64 = 300;

#[derive(Debug, serde::Serialize)]
pub struct OAuthCallback {
    pub code: String,
    pub state: String,
}

/// Bind localhost:`port` and wait for the OAuth redirect on `path` whose `state`
/// matches `expected_state`. Returns the captured code, or an error the frontend
/// can fall back on (port in use, timeout, or an OAuth error in the redirect).
#[tauri::command]
pub async fn start_oauth_callback_listener(
    expected_state: String,
    port: u16,
    path: String,
) -> Result<OAuthCallback, String> {
    tauri::async_runtime::spawn_blocking(move || {
        listen_on(port, &expected_state, &path, Duration::from_secs(TIMEOUT_SECS))
    })
    .await
    .map_err(|e| format!("OAuth listener task failed: {e}"))?
}

fn listen_on(
    port: u16,
    expected_state: &str,
    expected_path: &str,
    timeout: Duration,
) -> Result<OAuthCallback, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port))
        .map_err(|e| format!("callback port {port} unavailable: {e}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("failed to arm callback listener: {e}"))?;

    let deadline = Instant::now() + timeout;
    loop {
        if Instant::now() >= deadline {
            return Err("OAuth callback timed out".into());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                if let Some(result) = handle_connection(&mut stream, expected_state, expected_path) {
                    return result;
                }
                // Not our redirect (health check, favicon, state mismatch): keep waiting.
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(format!("callback accept failed: {e}")),
        }
    }
}

/// Returns Some(Ok/Err) when this connection is the terminal redirect; None to
/// keep listening.
fn handle_connection(
    stream: &mut TcpStream,
    expected_state: &str,
    expected_path: &str,
) -> Option<Result<OAuthCallback, String>> {
    stream.set_nonblocking(false).ok();
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();

    let mut buf = [0u8; 4096];
    let n = stream.read(&mut buf).unwrap_or(0);
    let request = String::from_utf8_lossy(&buf[..n]);
    let target = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("");

    let query = match target.split_once('?') {
        Some((path, q)) if path == expected_path => q,
        _ => {
            respond(stream, 404, "text/plain", "Not found");
            return None;
        }
    };

    let (mut code, mut state, mut error) = (None, None, None);
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        match k {
            "code" => code = Some(percent_decode(v)),
            "state" => state = Some(percent_decode(v)),
            "error" => error = Some(percent_decode(v)),
            _ => {}
        }
    }

    if let Some(err) = error {
        respond(stream, 400, "text/html; charset=utf-8", &page("Authorization failed", &format!("Error: {err}. You can close this window.")));
        return Some(Err(format!("authorization error: {err}")));
    }
    match (code, state) {
        (Some(code), Some(state)) if state == expected_state => {
            respond(stream, 200, "text/html; charset=utf-8", &page("Authorized", "Authentication complete. You can close this window and return to Reading-Partner."));
            Some(Ok(OAuthCallback { code, state }))
        }
        (_, Some(_)) => {
            // State mismatch: reject this request but keep the listener open.
            respond(stream, 400, "text/html; charset=utf-8", &page("State mismatch", "This request could not be verified. You can close this window."));
            None
        }
        _ => {
            respond(stream, 400, "text/plain", "Missing code or state");
            None
        }
    }
}

fn respond(stream: &mut TcpStream, status: u16, content_type: &str, body: &str) {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        _ => "Not Found",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn page(title: &str, message: &str) -> String {
    format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>{title}</title>\
         <style>body{{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#2b2b2b}}\
         .card{{text-align:center;max-width:420px;padding:32px}}h1{{font-size:18px;margin:0 0 8px}}p{{color:#666;margin:0}}</style></head>\
         <body><div class=\"card\"><h1>{title}</h1><p>{message}</p></div></body></html>"
    )
}

/// Minimal percent-decoding for query values (`%XX` and `+`).
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hi = (bytes[i + 1] as char).to_digit(16);
                let lo = (bytes[i + 2] as char).to_digit(16);
                if let (Some(hi), Some(lo)) = (hi, lo) {
                    out.push((hi * 16 + lo) as u8);
                    i += 3;
                    continue;
                }
                out.push(bytes[i]);
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::thread;

    fn send(port: u16, target: &str) -> String {
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        stream
            .write_all(format!("GET {target} HTTP/1.1\r\nHost: localhost\r\n\r\n").as_bytes())
            .unwrap();
        let mut resp = String::new();
        stream.read_to_string(&mut resp).unwrap();
        resp
    }

    #[test]
    fn captures_code_and_serves_success_page() {
        let port = 53701;
        let handle = thread::spawn(move || listen_on(port, "st8", "/callback", Duration::from_secs(5)));
        // Give the listener a moment to bind.
        thread::sleep(Duration::from_millis(150));
        let resp = send(port, "/callback?code=the-code&state=st8");
        assert!(resp.starts_with("HTTP/1.1 200"), "resp: {resp}");
        assert!(resp.contains("Authorized"), "success page missing: {resp}");
        let result = handle.join().unwrap().unwrap();
        assert_eq!(result.code, "the-code");
        assert_eq!(result.state, "st8");
    }

    #[test]
    fn ignores_state_mismatch_then_captures_match() {
        let port = 53702;
        let handle = thread::spawn(move || listen_on(port, "good", "/callback", Duration::from_secs(5)));
        thread::sleep(Duration::from_millis(150));
        let bad = send(port, "/callback?code=x&state=wrong");
        assert!(bad.starts_with("HTTP/1.1 400"), "bad: {bad}");
        let ok = send(port, "/callback?code=real&state=good");
        assert!(ok.starts_with("HTTP/1.1 200"), "ok: {ok}");
        assert_eq!(handle.join().unwrap().unwrap().code, "real");
    }

    #[test]
    fn matches_custom_callback_path() {
        // OpenAI (ChatGPT) uses /auth/callback on port 1455; a request to the
        // wrong path is ignored (404) while the listener keeps waiting.
        let port = 53704;
        let handle =
            thread::spawn(move || listen_on(port, "st9", "/auth/callback", Duration::from_secs(5)));
        thread::sleep(Duration::from_millis(150));
        let miss = send(port, "/callback?code=x&state=st9");
        assert!(miss.starts_with("HTTP/1.1 404"), "miss: {miss}");
        let ok = send(port, "/auth/callback?code=real&state=st9");
        assert!(ok.starts_with("HTTP/1.1 200"), "ok: {ok}");
        assert_eq!(handle.join().unwrap().unwrap().code, "real");
    }

    #[test]
    fn times_out_without_callback() {
        let port = 53703;
        let start = Instant::now();
        let result = listen_on(port, "s", "/callback", Duration::from_millis(300));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("timed out"));
        assert!(start.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn percent_decode_handles_escapes() {
        assert_eq!(percent_decode("a%2Bb%20c+d"), "a+b c d");
    }
}
