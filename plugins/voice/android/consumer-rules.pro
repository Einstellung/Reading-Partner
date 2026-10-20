# Tauri loads VoicePlugin by name, and VoiceNative's methods are bound by JNI
# name from libvoice_engine.so.
-keep class com.xinyuan.readingpartner.voice.** { *; }
