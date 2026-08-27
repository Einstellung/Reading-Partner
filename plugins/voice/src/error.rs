use serde::{ser::Serializer, Serialize};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    /// A host with no implementation. The message is shown to the user
    /// verbatim, same as every other rejection here.
    #[error("{0}")]
    Unsupported(String),
    /// A speaking run that could not start or could not finish. Separate from
    /// the one above because the host is fine and something else was not: no
    /// key in the environment, a vendor that refused, a player that would not
    /// take the audio.
    #[error("{0}")]
    Speech(String),
    // A rejection from the Swift side. This is the only channel dictation has
    // for reporting anything wrong: the event payload has no error kind, so a
    // failed start or a failed flush comes back as a rejected command.
    #[cfg(mobile)]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}

// Tauri rejects with whatever this produces, the webview renders it raw in a
// 12px amber line under the composer, so every variant's Display has to be a
// sentence a user can act on.
impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
