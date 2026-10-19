// The socket between the main process and the Android voice engine
// (docs/companion/89): a 4-byte little-endian length, a 1-byte type, then the
// body; control messages are JSON, PCM is raw 16-bit little-endian samples.
// Depends on serde only, so the plugin can link it without the engine. The
// message types come with the socket.

/// A frame longer than this closes the connection.
pub const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;
