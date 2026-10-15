//! Reading audio files for upload: tags and technical facts ([`tags`]) and
//! the BLAKE3 content hash ([`hash`]).
//! Used by `vault::prepare`; the app no longer imports or watches folders.

pub mod hash;
pub mod tags;
