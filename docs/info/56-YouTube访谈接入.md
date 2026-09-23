# YouTube 访谈接入

> 本文是 [17](./17-信息源系统.md)、[35](./35-简报漏斗.md)、[36](./36-采集端与阅读端.md) 的下游。定两件事：访谈视频靠 yt-dlp 取字幕当发现层和正文层；转写在取材相位之后多跑一次蒸馏压成摘要，之后漏斗不知道它是访谈。

现在不实现。docs/17 那套信息源系统将来要整体推翻重做，本文写在今天的 descriptor / engine 结构上，重做时按这里的事实和决定重新落。

只接 YouTube，播客不做。访谈类播客几乎都同时发 YouTube，只有音频的源（Ezra Klein、Hard Fork 这类）不覆盖；`<podcast:transcript>` 实测七个 feed 里只有 Acquired 有两条。

## 实测事实（2026-09-07）

- yt-dlp 官方 standalone zipapp 3 MB，取字幕不需要登录也不需要 PO token，三个视频三次成功，每次 5-7 秒。
- 频道 RSS 仍然活，一页 15 条。entry 不带时长，`media:description` 是空的，正片和 Shorts 靠 `<link>` 里的 `/watch?v=` 与 `/shorts/` 区分。Dwarkesh 最近 15 条里 11 条是 Shorts，都是正片剪出来的一分钟切片，标题和正片几乎一样。
- 人工字幕和自动字幕词数差 1%，人工的带说话人标记和标点；自动字幕的 VTT 体积是人工的 6 倍（每个词一条时间戳），去重后才可用。
- 一小时英文访谈约 1 万词、5.5 万字符、1.4 万 token（按 Lex #501 的人工字幕，10,237 词/小时）。
- yt-dlp 解析出来的字幕地址是签名的 timedtext URL，用 curl 直接请求拿到 429 和 Google 的 Sorry 页。取字幕必须在 yt-dlp 进程里完成，不能只让它解析、自己去 fetch。
- yt-dlp 2026 年起每次运行都警告找不到外部 JavaScript runtime。那条只影响下音视频格式，字幕不受影响（无 runtime 三次全成）。

## 源类型

discovery 加 `youtube-channel`：`{ kind: "youtube-channel", channelId, includeShorts?: false }`，实质是 feed 的特化加一道 Shorts 过滤，缺省过滤掉 Shorts。不过滤的话粗筛会被同一集的十个切片刷屏，而它手里只有标题、频道、日期，判不出来。

fulltext 加 `{ mode: "transcript" }`。取转写的函数像 `fetchViaWebview` 一样注入进 `Filled`，没有它的平台自动降级成 headline——现有 webview 模式已经把这个降级写好了，照抄。

yt-dlp 不打包进 Tauri。`externalBin` 写进主配置，iOS 构建会去找 `yt-dlp-aarch64-apple-ios`，而 `tauri.conf.json` 只有一份。要求采集端 PATH 里有 yt-dlp，找不到就把这类源标成不可用。调用串行加间隔，不并发。

要碰的文件：

- `descriptor.ts`：两个新类型，同步改 `validateDiscovery`、`validateFulltext`、组合校验和 `DESCRIPTOR_GUIDE`（AI 要能自己写这种描述符）。
- `engine.ts`：`collectSource` 的 discovery switch（434 行）和 `fetchBody` 的 fulltext switch（508 行）各加一支，新增 `fetchTranscript`。
- `item.ts`：`InfoItem` 加 `durationSec?`，蒸馏的提示词要时长。
- `builtins.ts`、`probe.ts`、`source-skill.ts`、`source-tools.ts`：AI 添源那条路要认识新类型。
- 测试：Shorts 过滤、VTT 去重解析、descriptor 校验都是纯函数。没加目录，`tests/layering.test.ts` 不改。

## 蒸馏层

`triage.ts` 的 `TRIAGE_TEXT_CHARS` 是 1500，`screen.ts` 的 `SCREEN_SUMMARY_CHARS` 是 400 且粗筛压根不看正文。整份转写塞进漏斗不报错也不涨钱，但 triage 拿开场三分钟的寒暄去判一场三小时的访谈。

做法：取材相位之后对视频源多跑一次蒸馏，把转写压成 1200-1500 字符的实质摘要，同时写进 `textContent` 和 `summary`。长度取这个区间是因为分拣只看前 1500 字符，摘要要恰好填满它；写进 summary 是让粗筛第二天再见到同一集时不再只有标题。之后 screen 和 triage 完全不知道这是访谈，它参与排序，也参与跨源去重。

提示词要求：保留具体主张、数字、分歧点，丢掉寒暄和过渡。这一步压坏了就是把一场好访谈判成噪音。

不单开一条不进分拣的 lane，那样访谈不参与跨源去重，播客讲过、彭博社也报过的同一件事会在简报里出现两遍。

新文件 `src/info/collect/digest.ts`，纯函数（提示词加解析），编排在 `live.ts`，接在 fetching 相位之后。按分层规矩留在 info 域，不进 capability。

成本（4 字符约 1 token）：

| 转写长度 | token | 蒸馏一场（Haiku 4.5） | 蒸馏一场（Sonnet 5） |
| --- | --- | --- | --- |
| 1 小时 | 13,700 | $0.018 | $0.035 |
| 2 小时 | 27,500 | $0.031 | $0.063 |
| 5.3 小时（Lex #501） | 72,300 | $0.076 | $0.152 |

用 Haiku。

## 没验的

yt-dlp 在没有 JS runtime 时下音频能不能成——本设计只取字幕，不需要下音频。Lex 官网转写页的现行 URL 规则（`lexfridman.com/dhh-transcript` 和 `/dhh` 实测都是 404）。

## 工作量

YouTube lane（discovery + fulltext + Shorts 过滤 + VTT 解析 + yt-dlp 调用 + 降级）2-3 天。蒸馏层（digest.ts + 接进 live.ts + 测试）1-1.5 天。

*2026-09-07*
