# qwen-audio-3.0-tts-plus / -flash 调用协议

实测日期 2026-08-27。每条标注「文档」或「实测」。文档与实测冲突处以实测为准。

## 1. HTTP + SSE 通不通

通。工程成本接近零，不需要 WebSocket。

端点和 `qwen3-tts-flash` 不同，别沿用旧路径：

| | qwen3-tts-flash（旧） | qwen-audio-3.0-tts-*（新） |
|---|---|---|
| path | `/api/v1/services/aigc/multimodal-generation/generation` | `/api/v1/services/audio/tts/SpeechSynthesizer` |
| 文本字段 | `input.text` | `input.text` |
| 音色字段 | `input.voice` | `input.voice` |
| 格式/采样率 | 不可选 | `input.format` / `input.sample_rate` |

host 用 `dashscope.aliyuncs.com`（实测）。文档给的是 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com`，实测不带 WorkspaceId 的公共 host 一样返回 200，两个模型都是。

请求（实测）：

```
POST https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer
Authorization: Bearer $DASHSCOPE_API_KEY
Content-Type: application/json
X-DashScope-SSE: enable

{"model":"qwen-audio-3.0-tts-flash",
 "input":{"text":"...","voice":"longanhuan_v3.6","format":"pcm","sample_rate":24000}}
```

响应 `content-type: text/event-stream;charset=UTF-8`，chunked。事件序列（实测）：

```
sentence-begin  → 无音频，带 normalized_text / original_text
sentence-synthesis × N → 音频在 output.audio.data，base64，要解码
sentence-end    → 无音频
最后一帧        → 无 type，finish_reason=stop，output.audio.url 指向完整文件，
                  同帧带 usage.characters 和 request_id
```

音频字段路径就是 `output.audio.data`，和 `tts_bench.py` 里 `dig_audio_b64` 的首选路径一致，不用走 fallback。

**参数错误返回 HTTP 200**（实测）。错误不在 HTTP 状态码上，而是 SSE 流里的一个 data 事件：`{"code":"InvalidParameter","message":"[cosyvoice:]Engine error [411]: TTS speak operation failed"}`。只看 status code 会把错误当成空音频。

不加 `X-DashScope-SSE` 是非流式：一次返回 JSON，`output.audio.data` 为空串，音频只在 `output.audio.url`，有效期 24 小时（实测 + 文档）。

服务端 ALPN 支持 h2；`ali3.py` 显式协商 `http/1.1`，因为分帧计时要靠 chunk 边界。keep-alive 连接复用实测可用，第二句起省掉 ~80ms 建连。

## 2. 账号状态与额度

两个模型都已开通，无未开通/欠费报错（实测，各跑通数十次）。

计费（文档，华北2 北京）：按输入字符计费，输出不计费。中文一字算 2 字符，标点/数字/字母算 1。

| 模型 | 单价 | 免费额度 |
|---|---|---|
| qwen-audio-3.0-tts-plus | 1.4 元 / 万字符 | 1 万字符 |
| qwen-audio-3.0-tts-flash | 1 元 / 万字符 | 1 万字符 |

免费额度有效期 90 天，且仅北京地域有。剩余额度没有公开 API 可查，只有控制台能看，所以这次没法给准确剩余值。可查的是每次调用的实际计费量：最后一帧的 `usage.characters`，`ali3.py` 已经记进 `billed_characters`（实测 22 字中文 → 42 字符）。

本次 spike 约 40 次合成调用，单句 ≤27 字，两个模型合计计费不超过 2000 字符。

## 3. 音频形态

全部实测。

**采样率可选**，和 `qwen3-tts-flash` 固定 24k 不同。`input.sample_rate` 传 8000 / 16000 / 22050 / 24000 / 44100 / 48000 都接受，且字节数按比例变化（同一句：16k → 137108 字节，24k → 207360，48k → 411080，时长都是 4.28-4.32 秒），是真重采样不是忽略参数。

**格式三种**：`pcm` / `wav` / `mp3`。

- `pcm`：裸 PCM16 单声道小端，无任何头。**推荐用这个**，直接绕开坑 187。
- `wav`：首帧前 44 字节是 RIFF 头，data chunk size 是占位符 `0x7FFFFFFF`，后续帧才是裸采样点——和 `qwen3-tts-flash` 完全一样的坑（坑 187）。`ali3.py` 里做了 `RIFF` 检测并跳过 44 字节。
- `mp3`：首帧带 ID3 头。

**首帧含 400ms 音频**（sr=24000 时 19200 字节）。plus 的首帧实测 380ms。

**后续帧粒度 400ms 的整数倍**，实测序列 `[400, 800, 400, 400, 800, 400, 800, 400, 400, 240]`，尾帧是余量。

**是真流式**。首帧占整句比例 0.079-0.093，远低于 0.4 的判据。

分段时间（22 字中文，sr=24000，format=pcm，直连，各 3 次）：

| | flash / longanhuan_v3.6 | plus / longanlingxin |
|---|---|---|
| 建连（dns+tcp+tls） | 75-84 ms | 75-84 ms |
| 发出→响应头 | 258-303 ms | 366-412 ms |
| 发出→首帧 PCM | 300-343 ms | 404-451 ms |
| 发出→整句收全 | 640-676 ms | 1268-1329 ms |
| 整句音频时长 | 4320 ms | 4202 ms |
| RTF | 0.148-0.156 | 0.302-0.316 |
| 首帧占比 | 0.093 | 0.091 |

参照：`qwen3-tts-flash` 上一轮是首帧固定 320ms、RTF 0.243。flash 的 RTF 更好，首帧含的音频更多（400ms vs 320ms）。复刻类基础音色的 RTF 明显高一些（实测 0.29-0.40），选型时别只看系统音色的数。

网络：本机 fake-ip，`peer_ip` 一律是 `198.18.0.219`，这说明不了走没走代理（坑 186）。TLS 握手 74-86ms，和坑 186 里加完 DIRECT 规则后的 78ms 一致，判定为直连，延迟数据可用。

## 4. 音色

系统音色两个模型各一套，**不通用**（文档）。实测：flash 传 plus 的 `longanlingxin` 报 `InvalidParameter`；反过来 plus 传 flash 的 `longanhuan_v3.6` 却成功返回音频——文档说的严格互斥只对了一半。

`qwen-audio-3.0-tts-plus` 系统音色只有 2 个（文档）：

- `longanlingxin` 龙安灵心，女 25，知心温暖音
- `longanlufeng` 龙安鲁风，男 25，明亮开朗音

`qwen-audio-3.0-tts-flash` 系统音色 12 个（文档）：`longanfengyue`（女30 自然亲切）、`longanyuanfei`（女30 高傲）、`longanlingxi`（女25 可爱甜美）、`longanxiaoxin`（女22 亲切活泼）、`longanhuan_v3.6`（女25）、`longjielidou_v3.6`/`longpaopao_v3.6`（儿童）、`longhuohuo_v3.6`/`longchuanshu_v3.6`（角色）、`loongmary`/`loongeva_v3.6`/`loongjohn`（英文）。

系统音色全是陪伴/儿童/角色向，**没有一个是播音向**——念科技简报不该从这里选。

另有基础音色（声音复刻预生成），每个模型 597 个，命名 `qwen-audio-3.0-tts-{plus|flash}-{后缀}`，两个模型后缀相同、可直接对调（实测 `qwen-audio-3.0-tts-flash-longliuxulan` 和 `qwen-audio-3.0-tts-plus-longliuxulan` 都成功）。表里带性别/年龄/特质/适用场景，已导出到 `flash-base-voices.tsv`。

适用场景分布（实测统计）：日常对话 316、情感陪伴 144、有声阅读 18、社交互动 17、动漫配音 16、新闻播报 12、电商直播 12。

**和小米「冰糖」气质接近的候选**（女声 + 新闻播报 + 标准播音音）：

| voice 参数 | 名称 | 年龄 | 特质 |
|---|---|---|---|
| `qwen-audio-3.0-tts-flash-longliuxulan` | 龙柳旭澜 | 25 | 标准播音音 |
| `qwen-audio-3.0-tts-flash-longyunfuhong` | 龙云芙鸿 | 25 | 标准播音音 |
| `qwen-audio-3.0-tts-flash-longfengyutong` | 龙凤雨桐 | 27 | 标准播音音 |
| `qwen-audio-3.0-tts-flash-longhuikeyuan` | 龙辉珂渊 | 28 | 标准播音音 |
| `qwen-audio-3.0-tts-flash-longhongfuxiu` | 龙鸿芙岫 | 42 | 标准播音音 |

另有男声播音 7 个和「沉稳大气音 / 冷静沉稳音」的有声阅读向若干，见 TSV。

## 5. 流式文本输入 / SSML / 读音控制

**流式文本输入：HTTP 不支持**（文档）。HTTP 一次发完整文本、流式返回音频；双向流式输入只有 WebSocket 有。按句合成按句接力的用法不需要它。

**SSML：这一系列没有**。文档只把 SSML 归给部分 CosyVoice 模型。实测传 `input.enable_ssml: true` 不报错但也无效——同一段带 `<speak>` / `<say-as>` 的文本，`enable_ssml` 为 true 和 false 时长都是 2960ms，和去掉标签的纯文本也是 2960ms。标签被静默剥掉，既不朗读也不生效。

**指令控制（instruction）：有效，这是这一代的读音控制手段**（实测）。`input.instruction` 传自然语言：

| instruction | 同句时长 |
|---|---|
| 无 | 4320 ms |
| 「请用非常快的语速朗读。」 | 3200 ms |
| 「请用非常缓慢庄重的语速朗读。」 | 7920 ms |

**rate / pitch / volume 也接受**（实测）：`input.rate: 1.2` → 时长 3563ms，正好是 4320/1.2，是精确变速不是近似。

情感与富语言标签（文档提到可在文本里嵌标签控情绪、插拟声）这次没测。

## 探针留下了什么

spike 的一次性脚本（`ali3.py`）、三个音频样本、597 行基础音色表和官方音色页快照都没有入库。上面的请求形状够复现，同目录的 `tts_bench.py` 已经内建这一路（`--legs ali3-flash-bc`，kind `dashscope3`），要重测走它。样本句是「英伟达市值一度突破五万亿美元，创下历史新高。」，24kHz / 单声道 / 16bit。

基础音色的完整清单只能从官方音色页取，本文第 4 节留的是筛过的候选和场景分布。
