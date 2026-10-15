# Vendored WavPack (libwavpack 5.x)

Decode-side sources of [WavPack](https://www.wavpack.com/) by David Bryant,
vendored from the `wavpack-sys` 0.4.0 crate package (upstream WavPack tree)
so the desktop app can decode `.wv` files without requiring CMake or
bindgen/libclang at build time. Compiled by `build.rs` with the `cc` crate;
the Rust bindings live in `src/audio/wv.rs` (hand-written, only the handful
of functions the player needs).

License: BSD-3-Clause — see [COPYING](COPYING).

Legacy (< 4.0) and DSD support are compiled out (`ENABLE_LEGACY` /
`ENABLE_DSD` not defined), matching upstream defaults.
