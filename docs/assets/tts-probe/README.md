# TTS 实测留档

2026-08-27 在 Linux 桌面机上量的 TTS 选型数据，四轮。结论吸收进 [33](../../33-语音简报.md) 的「实测」（延迟、音质、读音）和「小米落地要点」，候选状态在 [46](../../46-TTS供应商横评.md)，句首静音抖动那条在坑 188。实测发现结论不对时回来查这里。

第一轮，两家延迟：

- `raw-siliconflow-tun-full-1787802848.jsonl` — 硅基流动 `FunAudioLLM/CosyVoice2-0.5B`，音色 alex，40 句。
- `raw-dashscope-tun-full-1787802848.jsonl` — 阿里百炼 `qwen3-tts-flash`，音色 Cherry，40 句（39 句成功，第 27 句 `TimeoutError`）。

第二轮，加进小米三家同跑（label `three-way`，同一时段交替发送，同语料 40 句）：

- `raw-siliconflow-three-way-1787815824.jsonl` — 39 句成功。
- `raw-dashscope-three-way-1787815824.jsonl` — 40 句成功。
- `raw-mimo-three-way-1787815824.jsonl` — 小米 `mimo-v2.5-tts`，音色冰糖，40 句成功。**这一份的延迟数字不能用于选型**：`api.xiaomimimo.com` 不在 geosite 的 CN 列表里，被 Mihomo 分流到境外节点，TLS p50 881 ms、端到端首字 p50 2235 ms，全是绕远的账。另两家解析到 fake-ip 但走 DIRECT 出物理网卡。这一轮的语速和分块粒度仍然作数，那两项不经过网络。
- `raw-mimo-mimo-direct-1787817677.jsonl` — 把域名加进 Mihomo 的直连规则之后重跑的小米（label `mimo-direct`，18 句，17 句成功）。33 里引用的小米延迟全部出自这一份。注意这一份 meta 里 `network.state` 仍是 `transparent-tun`、`note` 仍写着「数据不可用于选型」：那是脚本按 fake-ip 解析结果自动判的，它看不到分流规则已经改成 DIRECT，TLS 从 881 ms 掉到 74.6 ms 才是证据。

第三轮，音质与读音：

- `quality-report-2026-08-27.md` — 三家的读音对照表、复核取样、客观音频指标、试听样本说明。31 句陷阱句加一段 375 字模拟简报，同一个 ASR（硅基流动 SenseVoiceSmall）回读做横向对照。
- 音频样本没有入库。原始 wav 加对齐响度的一组共十来个文件、三十多 MB，仓库里放不下；报告第四节列了每个文件的时长、大小、RMS 和样本文本，要复现就按那段文本重合成。合成与回读的脚本（`ttsq.py` / `retake.py` / `metrics.py` / `match.py`）也没有入库，报告里写了每一步的做法和判读规则。

第四轮，阿里新一代进来之后的延迟复测（label `ali3-round`，五条腿同时段交替发送，全程直连）：

- `raw-ali3-flash-bc-ali3-round-1787821014.jsonl` — `qwen-audio-3.0-tts-flash` 配基础音色 `qwen-audio-3.0-tts-flash-longliuxulan`（声音复刻预生成的标准播音音），40 句。
- `raw-ali3-plus-bc-ali3-round-1787821014.jsonl` — `qwen-audio-3.0-tts-plus` 配同一个音色后缀，40 句。
- `raw-mimo-ali3-round-1787821014.jsonl` — 小米冰糖，40 句发出、38 句成功；另 2 句是 `TimeoutError` 挂在建连上（异常抛在 `open_connection` 里，记录里连 `peer_ip` 和 `dns_ms` 都没有，请求根本没发出去），没有被算进任何分位数。
- `raw-ali-old-ali3-round-1787821014.jsonl` — `qwen3-tts-flash` / Cherry，15 句，把今天的网络和上一轮对齐用。
- `raw-ali3-flash-sys-ali3-round-1787821014.jsonl` — 同一个 flash 换成系统音色 `longanhuan_v3.6`，15 句，RTF 和句首静音的对照组。
- `latency-report-2026-08-27.md` — 这一轮的分位数表、三条判据、句首静音、计费口径和对上一轮的纵向参照。
- `qwen-audio-3-protocol-2026-08-27.md` — 阿里新一代的调用协议实测（端点、SSE 事件序列、格式与采样率、音色、instruction 控读音），2026-08-27 spike 的留档。

这五份的 meta 里 `network.state` 仍是 `transparent-tun`，和 `mimo-direct` 那份一样是脚本按 fake-ip 解析结果自动判的：这一轮两个域名都已经在 Mihomo 的 DIRECT 规则里，TLS p50 74.6–83.2 ms 才是证据。

脚本：

- `tts_bench.py` — 延迟测量脚本，四轮数据都出自它。2026-08-27 先加了小米那一路（环境变量 `MIMO_API_KEY`），第四轮又改成按「腿」轮转：一条腿是一个模型加一个音色，`LEGS` 表里登记，`--vendor` 那套按供应商选的参数随之取消。同一次改动加了句首／句尾静音和 `usage.characters` 两项测量。一次性写的，留着是因为干净网络或 iPhone 上复测要跑同一套口径。

## 测量条件

40 句科技新闻语料（脚本里的 `CORPUS`），每句 20 字上下的中文，含机构名、数字、英文缩写混排，合计 1096 字符。每句新建连接，这才是按句接力的真实情形。三家都是 24 kHz 16-bit 单声道：阿里和小米固定 24 kHz 不可选，硅基流动显式传 `sample_rate: 24000` 跟它对齐。小米走的是 `POST /v1/chat/completions`，要合成的文本放在 assistant 消息里，PCM 是 `choices[0].delta.audio.data` 里的 base64。

第四轮同一套语料、同样每句新建连接，五条腿里两条只跑前 15 句（分位数比 40 句那三条粗）。阿里新一代是第一个让调用方选采样率的，这一轮显式传 `format: pcm` + `sample_rate: 24000`：裸 PCM 没有 RIFF 头，绕开坑 187。

脚本只用标准库，自己建 socket、自己解 HTTP/1.1 chunk 和 SSE 帧，所以每一段都量在它真正发生的地方，chunk 边界是服务端实际 flush 的边界，不被客户端库的缓冲抹平。

**第一、二轮数据的限制：本机跑着 Mihomo TUN + fake-ip。** `api.siliconflow.cn` 解析到 198.18.0.222、`dashscope.aliyuncs.com` 解析到 198.18.0.219，全程在网络层被劫进隧道（meta 里 `network.state` 是 `transparent-tun`）。DNS 和 TCP 那两段测的是本地隧道，是假象；TLS 之后的每个数都含上游中转。所以绝对值偏高，不能单独引用。两家是同一条隧道、同一时段交替发送，隧道加的是共同常数项，两家之间的相对比较站得住；首帧粒度（`first_frame_audio_ms`）和 RTF 是服务端行为，根本不经过网络，在哪量都作数。

iPhone 上的绝对值没量过。

## JSONL 格式

每个文件第一行是 meta，中间每句一行，最后一行是汇总。

第一行 `_meta`：`label`、`timestamp` / `timestamp_iso`、`platform`、`reuse_conn`（是否复用连接）、`network`（透明代理检测结果、两个域名解析到的 IP、SO_MARK 是否可用）、`key_sources`（只记 key 从环境变量还是从 `.env` 读，不记值）、`sample_rate_siliconflow` / `sample_rate_dashscope`、`n`、`total_chars`。第四轮起多了 `legs`（这一轮每条腿的 kind / model / voice / 句数）、`sample_rate_requested`、`silence_thresholds_dbfs` 和 `silence_window_ms`，文件级的 `_leg` / `_model` / `_voice` 也在同一行。

每句一行的字段：

| 字段 | 含义 |
| --- | --- |
| `index` / `text` / `text_chars` | 语料里的第几句、原文、字符数 |
| `outcome` | `ok` / `content_rejected`（阿里 400 `DataInspectionFailed`）/ `http_error` / `error` |
| `status` / `error_code` / `error_message` | HTTP 状态码；失败时的异常类型和消息 |
| `peer_ip` | 实际连上的对端 IP，走隧道时是 198.18.x.x |
| `dns_ms` / `tcp_ms` / `tls_ms` / `connect_total_ms` | 建连各段耗时 |
| `ttfb_headers_ms` | 请求发完到收到响应头 |
| `first_frame_bytes_ms` / `first_pcm_ms` | 收到第一个 body chunk、以及解出第一帧可播 PCM（阿里要多走一次 base64 解码，差值记在 `first_frame_b64_decode_ms`） |
| `first_pcm_e2e_ms` | 端到端：从 DNS 起点算到第一帧可播 PCM，含建连。每句新建连接，这是用户实际等待 |
| `complete_ms` / `complete_e2e_ms` | 整句音频收全 |
| `frames` / `first_frame_bytes` / `total_pcm_bytes` | 服务端 flush 了几块、第一块多大、PCM 总字节 |
| `audio_path` | 实际取到音频的字段路径。硅基流动是 `raw-body`（裸 PCM），阿里是 `output.audio.data`，小米是 `choices[0].delta.audio.data` |
| `first_frame_audio_ms` | 第一块里含多少毫秒音频 |
| `mean_frame_audio_ms` / `audio_total_ms` | 平均每块含多少毫秒、整句音频时长 |
| `first_frame_ratio` | `first_frame_audio_ms / audio_total_ms` |
| `rtf` | `complete_ms / audio_total_ms`，合成耗时除以音频时长 |
| `leg` / `vendor` / `model` / `voice` | 第四轮起：这条记录属于哪条腿、打的哪家、哪个模型和音色 |
| `lead_silence_ms_t40` / `_t45` / `_t50` | 句首静音，三档阈值（-40 / -45 / -50 dBFS，10 ms 窗）各量一遍。汇总和 `audible_e2e_ms` 用 `_t45` |
| `tail_silence_ms_t40` / `_t45` / `_t50` | 句尾静音，同上 |
| `audible_e2e_ms` | `first_pcm_e2e_ms + lead_silence_ms_t45`，用户听见第一个字的时刻。选型看的是这个数，不是 `first_pcm_e2e_ms` |
| `billed_characters` | 服务端在末帧回的 `usage.characters`，只有 DashScope 给 |
| `riff_header_stripped_for_silence` | 首帧带 RIFF 头时置真：那 44 字节只在量静音前剥掉，字节数和计时不受影响（坑 187） |

最后一行 `_summary`：`n_total` / `n_ok` / `n_content_rejected` / `n_http_error` / `n_error`、被内容审核拒的句子索引和原文、以及每个字段的 `p50` / `p90` / `min` / `max` / `n`。

## 判据怎么读

`first_frame_ratio` 决定形态。小于 0.4 是真流式，按句接力成立；0.4 到 0.8 是分块很粗，接力有收益但有限；大于 0.8 是服务端整句缓冲后一次吐出，「流式」对首字延迟毫无帮助，按句接力这个形态要重想。

`rtf` 必须明显小于 1，否则前一句放完后一句还没合成好，接力会饿死。小于 0.7 才有余量。

`first_pcm_e2e_ms` 是首帧 PCM 到达，不是听见第一个字——句首静音要另外加。第三轮的三家是 85 / 375 / 117 ms（`quality-report-2026-08-27.md` 第三节）；第四轮起脚本自己逐句量，直接读 `audible_e2e_ms`。这一段不能当常数减：复刻音色的句首静音每次合成随机，标准差能到 89.6 ms（坑 188）。33 里定的判据是：p90 都超过 500 ms 才要重想按句接力这个形态；小米那一份 p90 是 1042 ms，没过，为什么这条 FAIL 不否决它写在 33 的「实测」。

`mean_frame_audio_ms` 和 `first_frame_audio_ms` 对比，能看出是不是只有首帧被攒大了。

内容审核单列。阿里的 400 `DataInspectionFailed` 是内容审核拒绝不是网络错误，脚本不重试，单独统计成 `n_content_rejected`。四轮加起来一次都没触发，所以这条分支只跑过 dry-run。

语速和每分钟成本不是 JSONL 里的字段，是从 `text` 和 `audio_total_ms` 现算的。按 `three-way` 那轮同语料算，三家是硅基流动 197.8（39 句 188.7 s、622 汉字）、阿里 192.4（40 句 200.5 s、643 汉字）、小米 193.8 汉字/分钟（40 句 199.0 s、643 汉字）；33 里往后按 195 汉字/分钟或 192–198 的区间算。第一轮那个 199.3 偏快，已经在 33 里改掉。

计费口径有三种，差 1.5 到 3 倍，别混：按字符（这份语料 1096）、1 汉字算 2 字符（1739）、按 UTF-8 字节（2522）。第四轮拿 `billed_characters` 验了第二种：阿里新一代精确等于 汉字×2 + 其余×1（40 句预测 1739 实测 1739，两个模型都一样），`qwen3-tts-flash` 不是这个口径（同 15 句实测 735、比公式多 69，多出的量和句中数字量正相关，像按展开后的读法计费），新旧模型的单价不能直接比。硅基流动 ¥0.05 每千 UTF-8 字节按第三种折——它的定价页写的是「每千字符 UTF-8」，按字节才对。小米限时免费，没有单价。

## 怎么复测

```bash
python3 tts_bench.py --dry-run                            # 不发请求，验证解析和统计逻辑
python3 tts_bench.py --dry-run --dry-scenario buffered    # 验证「整句缓冲」那条判据也能出结论
python3 tts_bench.py --n 40 --label wifi                             # 默认五条腿，即第四轮那一轮
python3 tts_bench.py --legs mimo --n 18 --label mimo-direct          # 只跑一条腿
python3 tts_bench.py --legs mimo,ali-old --n 40 --label wifi --reuse-conn   # 连接复用对照组
```

腿名是 `ali3-flash-bc` / `ali3-plus-bc` / `mimo` / `ali-old` / `ali3-flash-sys`，逗号分隔，每条腿跑几句写在脚本的 `LEGS` 表里（`--n` 是上限）。要换模型或音色就改那张表，命令行不再有 `--vendor` 和 per-vendor 的音色参数。硅基流动的请求路径还在脚本里（kind `siliconflow`），但没有一条腿用它，要跑得先往 `LEGS` 里加一条。

默认每句新建连接。`--reuse-conn` 是对照组，用来看掉的那部分是不是 TCP+TLS。其它参数：`--sample-rate`（对硅基流动和阿里新一代有效，旧模型和小米固定 24 kHz）、`--ds-language-type`、`--mimo-format`、`--timeout`、`--outdir`。

三把 key 环境变量优先，否则读仓库根目录的 `.env`（已 gitignored），`--env-file` 可改：

```
SILICONFLOW_API_KEY=sk-...
DASHSCOPE_API_KEY=sk-...
MIMO_API_KEY=...
```

key 不出现在任何输出里，控制台只打「来自环境变量」或「来自 <路径>」。

小米那个域名必须单独处理：它不在 geosite 的 CN 列表里，默认规则会把它分流到境外节点，`three-way` 那一轮就这么废掉了。做法见 `docs/pitfall/` 的「网络与 CSP」那一组。

要拿到不含隧道的绝对值，测之前三选一：把两个域名加进 Mihomo 的 DIRECT 规则（改完重载即可）；`sudo python3 tts_bench.py --mark 0x80000 ...` 走本机 `ip rule` 里 `5210: from all fwmark 0x80000/0xff0000 lookup main` 那条走物理网卡（SO_MARK 要 CAP_NET_ADMIN，普通用户设不了）；`--resolve api.siliconflow.cn:<真实IP>` 绕开 fake-ip DNS，但 TCP 仍可能被劫，只在 `ip route get <真实IP>` 确认不走 Mihomo 时有意义。清 `http_proxy` 这类环境变量没用，那些只影响会读它们的客户端库，这里是路由。

额度：一轮 40 句是 1096 字符，按 `usage.characters` 计费是 1739。阿里新一代 flash 和 plus 各有 1 万字符、90 天的免费额度（仅北京地域）。控制台之外没有查余额的 API，只能按每轮实测的计费量累加。
