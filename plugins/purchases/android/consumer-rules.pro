# Tauri constructs the plugin and invokes its commands by name.
-keep class com.xinyuan.readingpartner.purchases.PurchasesPlugin {
    public <init>(android.app.Activity);
    @app.tauri.annotation.Command public <methods>;
}
