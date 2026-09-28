# 语音跟随语言选项

## 愿景

设置里的「语言」（[81](../ui/81-多语言.md)）也管语音：听写语言、STT/TTS 的语言、语音通话和按住说话的界面文案，以及 iOS 的 `NSMicrophoneUsageDescription` 和桌面 `Info.plist` 的麦克风权限说明。

## 为什么现在不做

2026-09-28 项目发起人把语音从多语言第一轮里拿掉：比文字界面复杂，另做。

## 将来做时已知的事实

- 听写语言今天是独立设置 `dictationLocale`，只有 `zh-CN`、`en-US` 两项，没有「自动」（`src/platform/app/settings.ts` 的 `DictationLocale` 和 `DICTATION_LOCALE_OPTIONS`）。不设自动是因为跨语言识别出的是看似可信的错话，而这位读者的手机是 en-US、跟 AI 说中文（同文件注释，[33](../info/33-语音简报.md)）。所以听写语言不能直接等于界面语言。
- 设备实际支持约三十种，真正的清单是 `SpeechTranscriber.supportedLocales`；插件没有从 webview 读它的命令，所以下拉框写死两项（`settings.ts` 注释）。
- `dictationLocale` 在三处被读：`src/ui/components/chat/Composer.tsx`（按住说话）、`src/info/briefer/voice-call-live.ts`（语音通话）、`src/reading/rehearsal/transcript-source.ts`（排练转写）。
- 桌面听写走 STT 服务（默认硅基流动 SenseVoice），服务端自己判断语言，桌面忽略 `dictationLocale`（`settings.ts` 注释，[15](../companion/15-语音输入.md)）。
- TTS 是小米 MiMo `mimo-v2.5-tts`，默认音色「冰糖」，是四个中文音色之一（`plugins/voice/src/tts/mimo.rs`）。别的语言要另选音色或服务商。
- 麦克风权限说明：`src-tauri/Info.ios.plist` 与 `src-tauri/Info.plist` 各一条英文；iOS 本地化要加各语言的 `InfoPlist.strings`。桌面麦克风错误文案在 `src-tauri/src/voice.rs`。
- 要迁的前端文案在 [81](../ui/81-多语言.md) 清单末尾「延后（语音）」一行。
