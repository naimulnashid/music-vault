// Media3's FFmpeg audio decoder (decoder_ffmpeg 1.5.1, Apache 2.0) with only
// the ape and wavpack decoders, for the formats ExoPlayer can't play. The
// native library is prebuilt by build-ffmpeg.sh and committed under
// src/main/jniLibs, so this module builds without the NDK. See README.md.
plugins {
    alias(libs.plugins.android.library)
}

android {
    // Upstream's package, kept so DefaultRenderersFactory finds the renderer
    // by reflection and the JNI symbol names stay as they are.
    namespace = "androidx.media3.decoder.ffmpeg"
    compileSdk = 35

    defaultConfig {
        minSdk = 28
        consumerProguardFiles("proguard-rules.txt")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(libs.androidx.media3.decoder)
    implementation(libs.androidx.media3.exoplayer)
    implementation(libs.androidx.annotation)
    compileOnly(libs.checker.qual)
}
