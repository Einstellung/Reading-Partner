# Tauri 命令的参数按参数名取，写 `payload: T` 就逼 JS 多包一层

现象：Rust 侧的命令签名写成 `payload: T`，JS 侧发平铺的对象取不到，必须发 `{payload: {...}}`。

原因：命令的参数是按参数名从 JS 传来的对象里取的，参数名就是 JS 那一层的 key。

解法：想让 JS 发平铺对象，就把字段列成独立参数。当时的例子是探针命令 `start_probe` 的七个参数平铺开写；探针命令后来被听写命令取代，`start_probe` 已经不在插件里了，同一条规矩现在看 `start_dictation(locale, contextual_strings)`——两个字段照样是平铺的独立参数，不是包在一个对象里。
