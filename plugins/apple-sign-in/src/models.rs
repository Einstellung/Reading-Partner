// The shapes that cross to Swift and back. Swift decodes and encodes them with
// plain JSONDecoder/JSONEncoder and no key strategy, so the property names are
// exactly what serde writes.

use serde::{Deserialize, Serialize};

/// Arguments of `sign_in`: the SHA-256 (hex) of the raw nonce the frontend
/// keeps for the Supabase exchange.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInArgs {
    pub nonce: String,
}

/// What `sign_in` answers with. Every outcome is a value, never a rejection:
/// `ok` with the identity token, `cancelled` when the user closed the sheet, or
/// `error` with a sentence.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInResult {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancelled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
