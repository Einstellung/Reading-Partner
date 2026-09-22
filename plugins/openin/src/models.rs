// The one shape that crosses to Swift.

use serde::{Deserialize, Serialize};

/// Arguments of `open_in`. An absolute path inside the app's container, which
/// the frontend builds from appDataDir (src/platform/app/open-in.ts): the sheet
/// is handed a file URL and nothing else, so a relative path would resolve
/// against whatever the process happens to consider its current directory.
///
/// Swift decodes this with a plain JSONDecoder and no key strategy, so the
/// property name has to be exactly what serde writes.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenInArgs {
    pub path: String,
}
