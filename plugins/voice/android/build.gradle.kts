// The voice plugin's Android half (docs/companion/89): VoicePlugin in the main
// process, VoiceService and VoiceAudio in `:voice`. Laid out like
// tauri-plugin-haptics 2.3.3's android/. libvoice_engine.so comes in through
// src/main/jniLibs/arm64-v8a, written by scripts/android-voice-engine.sh.

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.xinyuan.readingpartner.voice"
    compileSdk = 36

    defaultConfig {
        minSdk = 24

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {

    implementation("androidx.core:core-ktx:1.9.0")
    implementation("androidx.appcompat:appcompat:1.6.0")
    implementation("com.google.android.material:material:1.7.0")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.15.3")
    testImplementation("junit:junit:4.13.2")
    implementation(project(":tauri-android"))
}
