#!/usr/bin/env bash
#
# Rebuilds src/main/jniLibs/<abi>/libffmpegJNI.so: FFmpeg with only the ape
# and wavpack decoders, linked into the Media3 FFmpeg extension's JNI glue.
#
# The .so files are committed, so an ordinary Gradle build needs no NDK. Run
# this only to change the FFmpeg version, the decoders or the JNI code.
#
# Needs bash (Git Bash works on Windows), git and the Android NDK. On Windows
# the NDK's own make.exe is used when there is no make on PATH.
#
#   ./build-ffmpeg.sh                 # all ABIs
#   ABIS="arm64-v8a" ./build-ffmpeg.sh
#
# Environment:
#   ANDROID_NDK  NDK root (default: <sdk>/ndk/$NDK_VERSION, sdk from ANDROID_HOME
#                or ../local.properties)
#   WORK         scratch folder for the FFmpeg checkout and builds. FFmpeg's
#                configure can't cope with spaces, so it must have none
#                (default: ${TMPDIR:-/tmp}/musicvault-ffmpeg)
set -euo pipefail

FFMPEG_TAG="n6.0.1" # Media3's decoder_ffmpeg README recommends the 6.0 branch.
DECODERS=(ape wavpack)
NDK_VERSION="27.1.12297006"
API=28 # = minSdk
ABIS="${ABIS:-arm64-v8a armeabi-v7a x86_64}"

HERE="$(cd "$(dirname "$0")" && pwd)"

# Mixed (C:/...) paths on Windows: native tools (cmake, make.exe) read them, and
# so does Git Bash.
native() { if command -v cygpath > /dev/null; then cygpath -m "$1"; else echo "$1"; fi; }

sdk_dir() {
  if [[ -n "${ANDROID_HOME:-}" ]]; then echo "$ANDROID_HOME"; return; fi
  local props="$HERE/../local.properties"
  [[ -f "$props" ]] || { echo "Set ANDROID_HOME or sdk.dir in apps/android/local.properties" >&2; exit 1; }
  # local.properties escapes ':' and '\' on Windows.
  sed -n 's/^sdk\.dir=//p' "$props" | sed 's/\\:/:/g; s/\\\\/\//g'
}

# Forward slashes: configure's shell eats the backslashes of a Windows path.
SDK="$(sdk_dir | tr '\\' '/')"
NDK="$(echo "${ANDROID_NDK:-$SDK/ndk/$NDK_VERSION}" | tr '\\' '/')"
[[ -d "$NDK" ]] || { echo "No NDK at $NDK (install NDK $NDK_VERSION or set ANDROID_NDK)" >&2; exit 1; }

case "$(uname -s)" in
  Linux*) HOST=linux-x86_64 ;;
  Darwin*) HOST=darwin-x86_64 ;;
  *) HOST=windows-x86_64 ;;
esac
TC="$NDK/toolchains/llvm/prebuilt/$HOST/bin"
MAKE="$(command -v make || echo "$NDK/prebuilt/$HOST/bin/make.exe")"
CMAKE_BIN="$(ls -d "$SDK"/cmake/*/bin 2> /dev/null | tail -1)"
JOBS="$(nproc 2> /dev/null || sysctl -n hw.ncpu 2> /dev/null || echo 4)"

WORK="${WORK:-${TMPDIR:-/tmp}/musicvault-ffmpeg}"
case "$WORK" in *" "*) echo "WORK must not contain spaces: $WORK" >&2; exit 1 ;; esac
mkdir -p "$WORK/tmp"
# configure's scratch files; Windows' TEMP has backslashes it can't use.
export TMPDIR="$WORK/tmp"

SRC="$WORK/ffmpeg"
if [[ ! -d "$SRC" ]]; then
  git -c advice.detachedHead=false clone --depth 1 --branch "$FFMPEG_TAG" https://git.ffmpeg.org/ffmpeg.git "$SRC"
fi
[[ "$(git -C "$SRC" describe --tags)" == "$FFMPEG_TAG" ]] || { echo "$SRC is not at $FFMPEG_TAG" >&2; exit 1; }

# Upstream's build_ffmpeg.sh options (Media3 1.5.1), with our decoder list.
COMMON=(
  --target-os=android --enable-static --disable-shared --disable-doc
  --disable-programs --disable-everything --disable-avdevice --disable-avformat
  --disable-swscale --disable-postproc --disable-avfilter --disable-symver
  --enable-swresample --extra-ldexeflags=-pie --disable-v4l2-m2m --disable-vulkan
  --nm="$TC/llvm-nm" --ar="$TC/llvm-ar" --ranlib="$TC/llvm-ranlib" --strip="$TC/llvm-strip"
)
for d in "${DECODERS[@]}"; do COMMON+=("--enable-decoder=$d"); done

for abi in $ABIS; do
  case "$abi" in
    arm64-v8a) ARCH=(--arch=aarch64 --cpu=armv8-a --cross-prefix="$TC/aarch64-linux-android$API-") ;;
    armeabi-v7a) ARCH=(--arch=arm --cpu=armv7-a --cross-prefix="$TC/armv7a-linux-androideabi$API-"
                       --extra-cflags="-march=armv7-a -mfloat-abi=softfp" --extra-ldflags="-Wl,--fix-cortex-a8") ;;
    x86_64) ARCH=(--arch=x86_64 --cpu=x86-64 --cross-prefix="$TC/x86_64-linux-android$API-" --disable-asm) ;;
    x86) ARCH=(--arch=x86 --cpu=i686 --cross-prefix="$TC/i686-linux-android$API-" --disable-asm) ;;
    *) echo "Unknown ABI $abi" >&2; exit 1 ;;
  esac
  PREFIX="$(native "$WORK/out/$abi")"
  echo "== FFmpeg $FFMPEG_TAG for $abi"
  (
    cd "$SRC"
    # The NDK's prebuilt folder also has a cmp.exe that can't read Git Bash
    # paths; only make is taken from it, by full path.
    ./configure --prefix="$PREFIX" "${ARCH[@]}" "${COMMON[@]}" > "$WORK/configure-$abi.log"
    grep -q "ff_ape_decoder" libavcodec/codec_list.c
    "$MAKE" -j"$JOBS" > "$WORK/make-$abi.log"
    "$MAKE" install-libs install-headers > /dev/null
    "$MAKE" distclean > /dev/null
  )

  echo "== libffmpegJNI.so for $abi"
  BUILD="$(native "$WORK/jni/$abi")"
  "$CMAKE_BIN/cmake" -G Ninja -S "$(native "$HERE/src/main/jni")" -B "$BUILD" \
    -DCMAKE_MAKE_PROGRAM="$(native "$CMAKE_BIN/ninja")" \
    -DCMAKE_TOOLCHAIN_FILE="$(native "$NDK/build/cmake/android.toolchain.cmake")" \
    -DANDROID_ABI="$abi" -DANDROID_PLATFORM="android-$API" -DCMAKE_BUILD_TYPE=Release \
    -DFFMPEG_PREFIX="$PREFIX" > "$WORK/cmake-$abi.log"
  "$CMAKE_BIN/cmake" --build "$BUILD" >> "$WORK/cmake-$abi.log"
  mkdir -p "$HERE/src/main/jniLibs/$abi"
  "$TC/llvm-strip" --strip-unneeded -o "$(native "$HERE/src/main/jniLibs/$abi/libffmpegJNI.so")" "$BUILD/libffmpegJNI.so"
  ls -l "$HERE/src/main/jniLibs/$abi/libffmpegJNI.so"
done
