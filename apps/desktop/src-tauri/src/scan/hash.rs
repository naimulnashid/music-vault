use std::fs::File;
use std::path::Path;

/// BLAKE3 hash of a file's bytes — a track's identity in the vault.
pub fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut hasher = blake3::Hasher::new();
    hasher.update_reader(File::open(path)?)?;
    Ok(hasher.finalize().to_hex().to_string())
}
