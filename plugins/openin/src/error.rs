use serde::{ser::Serializer, Serialize};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A host with no share sheet. The message is shown to the user verbatim.
    #[error("{0}")]
    Unsupported(String),
    /// A rejection from the Swift side: a path that did not parse, or no screen
    /// to present the sheet on.
    #[cfg(mobile)]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}

// Tauri rejects with whatever this produces and the webview renders it raw, so
// every variant's Display has to be a sentence a user can act on.
impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
