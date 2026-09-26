// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use serde::{Serialize, Serializer};
use url::Url;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Network(#[from] reqwest::Error),
    #[error(transparent)]
    Http(#[from] http::Error),
    #[error(transparent)]
    HttpInvalidHeaderName(#[from] http::header::InvalidHeaderName),
    #[error(transparent)]
    HttpInvalidHeaderValue(#[from] http::header::InvalidHeaderValue),
    /// URL not allowed by the scope.
    #[error("url not allowed on the configured scope: {0}")]
    UrlNotAllowed(Url),
    #[error(transparent)]
    UrlParseError(#[from] url::ParseError),
    /// HTTP method error.
    #[error(transparent)]
    HttpMethod(#[from] http::method::InvalidMethod),
    #[error("scheme {0} not supported")]
    SchemeNotSupport(String),
    #[error("Request canceled")]
    RequestCanceled,
    #[error(transparent)]
    FsError(#[from] tauri_plugin_fs::Error),
    #[error("failed to process data url")]
    DataUrlError,
    #[error("failed to decode data url into bytes")]
    DataUrlDecodeError,
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    #[error(transparent)]
    Utf8(#[from] std::string::FromUtf8Error),
    #[error("dangerous settings used but are not enabled")]
    DangerousSettings,
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&describe(self))
    }
}

// Reading-Partner patch, the reason this crate is vendored (src-tauri/Cargo.toml):
// upstream serializes `to_string()` alone, and reqwest's Display stops at
// "error sending request for url (…)" — the cause (dns, connect, TLS, timeout)
// is only in the source chain, which never reached JS. Append the whole chain,
// and drop the URL's query so a long one does not push the cause out of a
// one-line status.
pub(crate) fn describe(err: &Error) -> String {
    let mut out = match err {
        Error::Network(e) => without_query(e),
        _ => err.to_string(),
    };
    // `#[error(transparent)]` forwards source() to the wrapped error's source,
    // so the chain starts below the line already written.
    let mut source = std::error::Error::source(err);
    while let Some(s) = source {
        out.push_str(": ");
        out.push_str(&s.to_string());
        source = s.source();
    }
    out
}

fn without_query(e: &reqwest::Error) -> String {
    let full = e.to_string();
    match e.url() {
        Some(url) if url.query().is_some() => {
            let mut short = url.clone();
            short.set_query(None);
            full.replace(url.as_str(), &format!("{short}?…"))
        }
        _ => full,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_send_failure_carries_its_cause_and_drops_the_query() {
        // Nothing listens on port 1, so the connect is refused locally.
        let err: Error = tauri::async_runtime::block_on(
            reqwest::Client::new()
                .get("http://127.0.0.1:1/drive/v3/files?q=%27abc%27%20in%20parents&fields=x")
                .send(),
        )
        .unwrap_err()
        .into();
        let msg = describe(&err);
        assert!(
            msg.starts_with("error sending request for url (http://127.0.0.1:1/drive/v3/files?…): "),
            "{msg}"
        );
        assert!(msg.contains("tcp connect error"), "{msg}");
        assert!(!msg.contains("parents"), "{msg}");
    }

    #[test]
    fn other_errors_keep_their_display() {
        assert_eq!(describe(&Error::RequestCanceled), "Request canceled");
    }
}

pub type Result<T> = std::result::Result<T, Error>;
