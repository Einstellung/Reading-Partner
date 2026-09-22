// The one shape that crosses to Swift.

use serde::{Deserialize, Serialize};

/// Arguments of `open_in`. An absolute path inside the app's container, which
/// the frontend builds from appDataDir (src/platform/app/open-in.ts): the sheet
/// is handed a file URL and nothing else, so a relative path would resolve
/// against whatever the process happens to consider its current directory.
///
/// `name` is the display file name — extension included — the reader should see
/// in the sheet and in whatever app receives the file. The library stores a book
/// under its content hash, so without this the reader gets a 64-character name
/// everywhere the file goes. Swift copies the file to a temporary directory
/// under that name; omitted, the file is handed over where it lies.
///
/// Swift decodes this with a plain JSONDecoder and no key strategy, so the
/// property names have to be exactly what serde writes.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenInArgs {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}
