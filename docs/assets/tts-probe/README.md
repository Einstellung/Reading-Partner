# TTS 首包延迟实测留档

2026-08-27 在 Linux 桌面机上量的两家 TTS 按句首包延迟。结论已吸收进 [33](../../33-语音简报.md) 的「首包延迟实测」。实测发现结论不对时回来查这里。

- `raw-siliconflow-tun-full-1787802848.jsonl` — 硅基流动 `FunAudioLLM/CosyVoice2-0.5B`，音色 alex，40 句。
- `raw-dashscope-tun-full-1787802848.jsonl` — 阿里百炼 `qwen3-tts-flash`，音色 Cherry，40 句（39 句成功，第 27 句 `TimeoutError`）。
- `tts_bench.py` — 测量脚本。一次性写的，留着是因为干净网络或 iPhone 上复测要跑同一套口径。

## 测量条件

40 句科技新闻语料（脚本里的 `CORPUS`），每句 20 字上下的中文，含机构名、数字、英文缩写混排，合计 1096 字符。每句新建连接，这才是按句接力的真实情形。两家都取 24 kHz 16-bit 单声道：阿里固定 24 kHz 不可选，硅基流动显式传 `sample_rate: 24000` 跟它对齐。

脚本只用标准库，自己建 socket、自己解 HTTP/1.1 chunk 和 SSE 帧，所以每一段都量在它真正发生的地方，chunk 边界是服务端实际 flush 的边界，不被客户端库的缓冲抹平。

**这轮数据的限制：本机跑着 Mihomo TUN + fake-ip。** `api.siliconflow.cn` 解析到 198.18.0.222、`dashscope.aliyuncs.com` 解析到 198.18.0.219，全程在网络层被劫进隧道（meta 里 `network.state` 是 `transparent-tun`）。DNS 和 TCP 那两段测的是本地隧道，是假象；TLS 之后的每个数都含上游中转。所以绝对值偏高，不能单独引用。两家是同一条隧道、同一时段交替发送，隧道加的是共同常数项，两家之间的相对比较站得住；首帧粒度（`first_frame_audio_ms`）和 RTF 是服务端行为，根本不经过网络，在哪量都作数。

iPhone 上的绝对值没量过。

## JSONL 格式

每个文件第一行是 meta，中间每句一行，最后一行是汇总。

第一行 `_meta`：`label`、`timestamp` / `timestamp_iso`、`platform`、`reuse_conn`（是否复用连接）、`network`（透明代理检测结果、两个域名解析到的 IP、SO_MARK 是否可用）、`key_sources`（只记 key 从环境变量还是从 `.env` 读，不记值）、`sample_rate_siliconflow` / `sample_rate_dashscope`、`n`、`total_chars`。

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
| `audio_path` | 实际取到音频的字段路径。硅基流动是 `raw-body`（裸 PCM），阿里是 `output.audio.data` |
| `first_frame_audio_ms` | 第一块里含多少毫秒音频 |
| `mean_frame_audio_ms` / `audio_total_ms` | 平均每块含多少毫秒、整句音频时长 |
| `first_frame_ratio` | `first_frame_audio_ms / audio_total_ms` |
| `rtf` | `complete_ms / audio_total_ms`，合成耗时除以音频时长 |

最后一行 `_summary`：`n_total` / `n_ok` / `n_content_rejected` / `n_http_error` / `n_error`、被内容审核拒的句子索引和原文、以及每个字段的 `p50` / `p90` / `min` / `max` / `n`。

## 判据怎么读

`first_frame_ratio` 决定形态。小于 0.4 是真流式，按句接力成立；0.4 到 0.8 是分块很粗，接力有收益但有限；大于 0.8 是服务端整句缓冲后一次吐出，「流式」对首字延迟毫无帮助，按句接力这个形态要重想。

`rtf` 必须明显小于 1，否则前一句放完后一句还没合成好，接力会饿死。小于 0.7 才有余量。

`first_pcm_e2e_ms` 是用户按下播放到听见第一个字的实际等待。33 里定的判据是：两家 p90 都超过 500 ms 才要重想按句接力这个形态。

`mean_frame_audio_ms` 和 `first_frame_audio_ms` 对比，能看出是不是只有首帧被攒大了。

内容审核单列。阿里的 400 `DataInspectionFailed` 是内容审核拒绝不是网络错误，脚本不重试，单独统计成 `n_content_rejected`。

语速和每分钟成本不是 JSONL 里的字段，是从 `text` 和 `audio_total_ms` 现算的：汉字数除以音频总分钟数得 199.3 汉字/分钟（硅基流动 40 句，193.6 s，643 汉字 + 453 个数字/英文/标点，UTF-8 共 2522 字节）；阿里 39 句 191.7 s、626 汉字，195.9 汉字/分钟。计费按硅基流动 ¥0.05 每千 UTF-8 字节、阿里 ¥0.8 每万字符（汉字计 2 字符，本轮 1699 字符）折算。

## 怎么复测

```bash
python3 tts_bench.py --dry-run                            # 不发请求，验证解析和统计逻辑
python3 tts_bench.py --dry-run --dry-scenario buffered    # 验证「整句缓冲」那条判据也能出结论
python3 tts_bench.py --vendor both --n 40 --label wifi
python3 tts_bench.py --vendor both --n 40 --label wifi --reuse-conn   # 连接复用对照组
```

默认每句新建连接。`--reuse-conn` 是对照组，用来看掉的那部分是不是 TCP+TLS。其它参数：`--sample-rate`（只对硅基流动有效）、`--sf-voice` / `--sf-model`、`--ds-voice` / `--ds-model`、`--ds-language-type`、`--timeout`、`--outdir`。

两把 key 环境变量优先，否则读仓库根目录的 `.env`（已 gitignored），`--env-file` 可改：

```
SILICONFLOW_API_KEY=sk-...
DASHSCOPE_API_KEY=sk-...
```

key 不出现在任何输出里，控制台只打「来自环境变量」或「来自 <路径>」。

要拿到不含隧道的绝对值，测之前三选一：把两个域名加进 Mihomo 的 DIRECT 规则（改完重载即可）；`sudo python3 tts_bench.py --mark 0x80000 ...` 走本机 `ip rule` 里 `5210: from all fwmark 0x80000/0xff0000 lookup main` 那条走物理网卡（SO_MARK 要 CAP_NET_ADMIN，普通用户设不了）；`--resolve api.siliconflow.cn:<真实IP>` 绕开 fake-ip DNS，但 TCP 仍可能被劫，只在 `ip route get <真实IP>` 确认不走 Mihomo 时有意义。清 `http_proxy` 这类环境变量没用，那些只影响会读它们的客户端库，这里是路由。

额度：一轮 40 句是 1096 字符。阿里 90 天 1 万字符免费额度按 `usage.characters` 计费，最坏情况能跑 9 轮。
