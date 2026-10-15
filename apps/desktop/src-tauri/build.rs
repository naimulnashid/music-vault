fn main() {
    // Vendored libwavpack (decode only) — see vendor/wavpack/README.md.
    let sources = [
        "common_utils", "decorr_utils", "entropy_utils", "extra1", "extra2",
        "open_utils", "open_filename", "open_legacy", "open_raw", "pack",
        "pack_dns", "pack_floats", "pack_utils", "read_words", "tags",
        "tag_utils", "unpack", "unpack_floats", "unpack_seek", "unpack_utils",
        "write_words",
    ];
    let mut build = cc::Build::new();
    for s in sources {
        build.file(format!("vendor/wavpack/src/{s}.c"));
    }
    build
        .include("vendor/wavpack/include")
        .include("vendor/wavpack/src")
        .define("_CRT_SECURE_NO_WARNINGS", None)
        .warnings(false)
        .compile("wavpack");
    println!("cargo:rerun-if-changed=vendor/wavpack");

    tauri_build::build()
}
