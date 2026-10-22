# FFmpeg decoder module (APE and WavPack)

ExoPlayer (Media3) has no decoder and no extractor for Monkey's Audio (`.ape`) or
WavPack (`.wv`). This module supplies the decoders; the extractors live in the app
([`playback/formats`](../app/src/main/java/com/musicvault/playback/formats)).

- `src/main/java/androidx/media3/decoder/ffmpeg/`: Media3's `decoder_ffmpeg`
  extension from the `1.5.1` tag (Apache 2.0, audio files only), modified so that it
  maps only the `audio/x-ape` and `audio/x-wavpack` MIME types, passes the stream
  parameters those decoders need, and trims the decoded frame that straddles a seek
  target (an APE frame can hold several seconds). Every modified file says so in its
  header.
- `src/main/jni/`: the extension's JNI glue and CMake file, modified the same way.
- `src/main/jniLibs/<abi>/libffmpegJNI.so`: prebuilt and committed, so a normal
  Gradle build needs no NDK. Built for `arm64-v8a`, `armeabi-v7a` and `x86_64`
  (emulators); a device of any other ABI plays everything except these two formats.

The package stays `androidx.media3.decoder.ffmpeg` so that `DefaultRenderersFactory`
in `EXTENSION_RENDERER_MODE_PREFER` (set in `VaultPlayer`) finds `FfmpegAudioRenderer`
by reflection, and the JNI symbol names match upstream.

## Rebuilding the native library

Only needed to change the FFmpeg version, the decoder list or the JNI code. From
`apps/android/ffmpeg`, in bash (Git Bash on Windows):

```bash
./build-ffmpeg.sh
```

It clones FFmpeg `n6.0.1` (the 6.0 branch is what Media3's README recommends) into a
scratch folder, configures it with `--disable-everything --enable-decoder=ape
--enable-decoder=wavpack`, builds static libraries per ABI, links them into
`libffmpegJNI.so` with CMake and the NDK (version pinned in the script), and writes the
results to `src/main/jniLibs`. `WORK` picks the scratch folder (FFmpeg's configure
needs a path without spaces) and `ABIS` the ABIs.

## Licences

- Media3 code (Java, JNI, CMake): Apache License 2.0, Copyright The Android Open
  Source Project.
- FFmpeg: LGPL 2.1 or later. It is configured without `--enable-gpl` or
  `--enable-nonfree`, and configure reports "LGPL version 2.1 or later". Source:
  <https://git.ffmpeg.org/ffmpeg.git>, tag `n6.0.1`. FFmpeg is linked statically into
  `libffmpegJNI.so`, as in Media3's own build; this folder holds everything needed to
  rebuild that library from the FFmpeg source.
