#!/usr/bin/env python3
"""One-off TTS first-packet latency benchmark: SiliconFlow CosyVoice2 vs DashScope qwen3-tts-flash.

Throwaway measurement tool. Not part of the repo.

The question it answers: for one short sentence, how long from "request sent" to
"first playable PCM frame", and how many milliseconds of audio are in that first
frame. If the first frame already contains the whole sentence, the server buffers
and per-sentence pipelining buys nothing.

Stdlib only: raw socket + ssl + hand-rolled HTTP/1.1 chunk parsing, so that every
segment boundary (DNS / TCP / TLS / headers / first body chunk) is measured where
it actually happens, and HTTP chunk framing is observed exactly as the server
flushed it rather than through a buffering client library.
"""

import argparse
import base64
import json
import os
import socket
import ssl
import statistics
import sys
import time

# --------------------------------------------------------------------------
# Clock. Real runs use perf_counter. --dry-run swaps in a virtual clock so the
# parsing/timing path executes identically but costs no wall time.
# --------------------------------------------------------------------------


class RealClock:
    virtual = False

    def now(self):
        return time.perf_counter()

    def advance(self, dt):
        pass


class VirtualClock:
    virtual = True

    def __init__(self):
        self.t = 0.0

    def now(self):
        return self.t

    def advance(self, dt):
        self.t += dt


CLOCK = RealClock()


def ms(a, b):
    return (b - a) * 1000.0


# --------------------------------------------------------------------------
# Corpus: 40 tech-news declarative sentences, ~20 chars, mixing organisation
# names, figures and Latin acronyms. That mix is the real briefing distribution
# and also the one most likely to trip DashScope's content inspection.
# --------------------------------------------------------------------------

CORPUS = [
    "英伟达发布 H200 芯片，显存带宽提升至每秒 4.8TB。",
    "OpenAI 宣布 GPT-5 将于第三季度向企业客户开放 API。",
    "台积电two nm 制程明年量产，月产能规划 5 万片晶圆。",
    "字节跳动豆包大模型日均调用量突破 3 万亿 tokens。",
    "谷歌 DeepMind 发布 Gemini 3，上下文窗口扩至 200 万。",
    "阿里云通义千问开源 72B 模型，权重可商用。",
    "苹果 M5 芯片神经引擎算力较上代提升约 40%。",
    "中科院团队实现 1024 比特超导量子芯片流片。",
    "微软 Azure 季度营收增长 31%，AI 业务贡献 12 个百分点。",
    "Meta 将 Llama 4 训练集群扩至 35 万张 H100。",
    "特斯拉 FSD v14 在北美开放，接管率下降 60%。",
    "华为昇腾 910C 出货量预计明年达到 80 万片。",
    "SpaceX 星舰第十二次试飞成功完成轨道再入。",
    "AMD 收购 AI 芯片初创公司，交易金额约 49 亿美元。",
    "百度文心一言用户规模突破 4 亿，日活增长 20%。",
    "三星 HBM4 通过英伟达验证，明年一季度供货。",
    "欧盟 AI 法案通用模型条款正式生效，违规最高罚 3%。",
    "腾讯混元大模型接入微信搜一搜，覆盖 13 亿用户。",
    "英特尔 18A 制程良率改善，代工业务亏损收窄。",
    "OpenAI 与新闻集团达成协议，五年授权费超 2.5 亿美元。",
    "小米汽车二季度交付 8.6 万辆，毛利率升至 26%。",
    "Anthropic 完成新一轮融资，估值达到 1830 亿美元。",
    "商汤科技发布日日新 6.0，推理成本下降 70%。",
    "美国商务部更新出口管制清单，新增 14 家实体。",
    "亚马逊 Trainium 3 芯片投产，单卡训练性能翻倍。",
    "Arm 宣布进军服务器芯片，首款产品面向数据中心。",
    "月之暗面 Kimi 支持 200 万字上下文，免费开放。",
    "中国信通院数据显示，算力规模同比增长 30%。",
    "苹果与阿里合作在国行 iPhone 部署 AI 功能。",
    "Stability AI 因版权诉讼与摄影师达成和解。",
    "英伟达市值一度突破 5 万亿美元，创历史新高。",
    "京东云发布言犀大模型 4.0，主打供应链场景。",
    "OpenAI 首席科学家离职，创办新的 AI 安全公司。",
    "工信部启动 5G-A 商用试点，覆盖 30 个重点城市。",
    "某云服务商配置错误导致数据泄露，影响 12 万用户。",
    "美光宣布上调 DRAM 报价，涨幅约为 15% 到 20%。",
    "科技公司裁员潮持续，本季度累计裁减 4.2 万人。",
    "RISC-V 基金会发布服务器规范 1.0，龙芯参与制定。",
    "字节跳动豆包 App 月活跃用户达到 1.5 亿。",
    "谷歌因反垄断被判拆分广告业务，公司已提出上诉。",
]

DEFAULT_ENV_FILE = "/home/xinyuan/Documents/Github/Reading-Partner/.env"

SO_MARK = 36  # socket.SO_MARK, not exposed on all Python builds

VENDORS = ("siliconflow", "dashscope", "mimo")

SF_HOST = "api.siliconflow.cn"
SF_PATH = "/v1/audio/speech"
SF_MODEL = "FunAudioLLM/CosyVoice2-0.5B"
SF_VOICE = "FunAudioLLM/CosyVoice2-0.5B:alex"

DS_HOST = "dashscope.aliyuncs.com"
DS_PATH = "/api/v1/services/aigc/multimodal-generation/generation"
DS_MODEL = "qwen3-tts-flash"
DS_VOICE = "Cherry"
DS_SAMPLE_RATE = 24000  # fixed by the model, not selectable

MIMO_HOST = "api.xiaomimimo.com"
MIMO_PATH = "/v1/chat/completions"          # chat-shaped, not /v1/audio/speech
MIMO_MODEL = "mimo-v2.5-tts"
MIMO_VOICE = "冰糖"                          # 冰糖 / 茉莉 / 苏打 / 白桦, passed as a literal
MIMO_FORMAT = "pcm16"
MIMO_SAMPLE_RATE = 24000  # fixed by the model, not selectable

VENDOR_HOSTS = {"siliconflow": SF_HOST, "dashscope": DS_HOST, "mimo": MIMO_HOST}
KEY_VARS = {"siliconflow": "SILICONFLOW_API_KEY",
            "dashscope": "DASHSCOPE_API_KEY",
            "mimo": "MIMO_API_KEY"}
# Only SiliconFlow lets the caller pick a rate; the other two are fixed by the model.
# They agree on 24000 today, which is a coincidence, not a shared constant.
FIXED_SAMPLE_RATES = {"dashscope": DS_SAMPLE_RATE, "mimo": MIMO_SAMPLE_RATE}


def sample_rate_for(vendor, cfg):
    if vendor == "siliconflow":
        return cfg["sample_rate"]
    return FIXED_SAMPLE_RATES[vendor]


def load_env_file(path):
    """Parse a dotenv file into a dict. Only whole-line comments are dropped: an
    inline '#' is kept, since an unquoted secret may legitimately contain one."""
    out = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                if line.startswith("export "):
                    line = line[len("export "):]
                k, _, v = line.partition("=")
                k, v = k.strip(), v.strip()
                if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                    v = v[1:-1]
                if k:
                    out[k] = v
    except OSError:
        return {}
    return out


def resolve_key(var, env_file_values):
    """Environment wins over the .env file. Returns (value, source) — never the value
    in any log line; only the source is ever printed."""
    v = os.environ.get(var)
    if v:
        return v, "env"
    v = env_file_values.get(var)
    if v:
        return v, "dotenv"
    return "", "missing"


# --------------------------------------------------------------------------
# Proxy / transparent-tunnel detection
# --------------------------------------------------------------------------

PROXY_ENV = ("http_proxy", "https_proxy", "all_proxy", "no_proxy",
             "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY")


def _is_fake_ip(ip):
    """198.18.0.0/15 is the benchmarking range Clash/Mihomo hand out in fake-ip mode."""
    try:
        a, b = (int(x) for x in ip.split(".")[:2])
    except ValueError:
        return False
    return a == 198 and b in (18, 19)


def detect_network(hosts):
    """Report how much of the proxy this process can actually get out from under."""
    env_set = sorted(k for k in PROXY_ENV if os.environ.get(k) and not k.lower().startswith("no_"))
    resolved, fake = {}, []
    for h in hosts:
        try:
            ip = socket.getaddrinfo(h, 443, socket.AF_INET, socket.SOCK_STREAM)[0][4][0]
        except OSError as e:
            ip = f"<resolve failed: {e}>"
        resolved[h] = ip
        if _is_fake_ip(ip):
            fake.append(h)

    can_mark = False
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, SO_MARK, 0x80000)
        can_mark = True
    except OSError:
        pass
    finally:
        s.close()

    if fake:
        state = "transparent-tun"
        note = ("检测到透明代理 (TUN / fake-ip)：%s 解析到 198.18.0.0/15。"
                "本进程无法绕开——env 变量与之无关，路由在网络层。"
                "DNS/TCP/TLS 分段测的是本地隧道，首包延迟含上游中转。数据不可用于选型。"
                % ", ".join(fake))
    elif env_set:
        state = "env-proxy-bypassed"
        note = "检测到代理环境变量 (%s)；脚本自建 socket 直连，已绕开。" % ", ".join(env_set)
    else:
        state = "direct"
        note = "未检测到代理。"

    return {
        "state": state,
        "note": note,
        "env_proxy_vars": env_set,
        "resolved": resolved,
        "so_mark_permitted": can_mark,
    }


# --------------------------------------------------------------------------
# Timed byte reader over a socket-like object
# --------------------------------------------------------------------------


class Eof(Exception):
    pass


class TimedReader:
    """Buffered reader that timestamps each recv, so a parsed frame can be dated
    to the moment its final byte actually landed."""

    def __init__(self, sock, bufsize=65536):
        self.sock = sock
        self.bufsize = bufsize
        self.buf = bytearray()
        self.last_recv_t = None
        self.total_recv = 0

    def _fill(self):
        d = self.sock.recv(self.bufsize)
        self.last_recv_t = CLOCK.now()
        if not d:
            raise Eof()
        self.buf.extend(d)
        self.total_recv += len(d)

    def read_exact(self, n):
        while len(self.buf) < n:
            self._fill()
        out = bytes(self.buf[:n])
        del self.buf[:n]
        return out, self.last_recv_t

    def read_line(self):
        while True:
            i = self.buf.find(b"\n")
            if i >= 0:
                out = bytes(self.buf[:i + 1])
                del self.buf[:i + 1]
                return out, self.last_recv_t
            self._fill()

    def read_rest(self):
        try:
            while True:
                self._fill()
        except (Eof, OSError):
            pass
        out = bytes(self.buf)
        self.buf.clear()
        return out, self.last_recv_t


# --------------------------------------------------------------------------
# Minimal HTTP/1.1 client with exact chunk framing
# --------------------------------------------------------------------------


def open_connection(host, port, timeout, mark=None, resolve_ip=None):
    t0 = CLOCK.now()
    if resolve_ip:
        ip = resolve_ip
        t_dns = CLOCK.now()
    else:
        ip = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)[0][4][0]
        t_dns = CLOCK.now()

    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    if mark is not None:
        s.setsockopt(socket.SOL_SOCKET, SO_MARK, mark)
    s.connect((ip, port))
    t_tcp = CLOCK.now()

    ctx = ssl.create_default_context()
    ctx.set_alpn_protocols(["http/1.1"])
    ss = ctx.wrap_socket(s, server_hostname=host)
    t_tls = CLOCK.now()

    return ss, {
        "peer_ip": ip,
        "dns_ms": ms(t0, t_dns),
        "tcp_ms": ms(t_dns, t_tcp),
        "tls_ms": ms(t_tcp, t_tls),
        "connect_total_ms": ms(t0, t_tls),
        "t_start": t0,
        "t_connected": t_tls,
    }


def send_request(sock, host, path, headers, body, keep_alive):
    lines = [f"POST {path} HTTP/1.1", f"Host: {host}"]
    for k, v in headers.items():
        lines.append(f"{k}: {v}")
    lines.append(f"Content-Length: {len(body)}")
    lines.append("Accept-Encoding: identity")  # gzip would destroy the framing math
    lines.append("Connection: " + ("keep-alive" if keep_alive else "close"))
    raw = ("\r\n".join(lines) + "\r\n\r\n").encode("utf-8") + body
    sock.sendall(raw)
    return CLOCK.now()


def read_response_head(reader):
    line, t = reader.read_line()
    parts = line.decode("latin-1").strip().split(" ", 2)
    status = int(parts[1]) if len(parts) > 1 else 0
    headers = {}
    while True:
        line, t = reader.read_line()
        if line in (b"\r\n", b"\n"):
            break
        k, _, v = line.decode("latin-1").partition(":")
        headers[k.strip().lower()] = v.strip()
    return status, headers, t


def iter_body(reader, headers):
    """Yield (bytes, arrival_ts) per server flush.

    Chunked: one yield per HTTP chunk, i.e. exactly what the server flushed.
    Otherwise: content-length or read-to-close, yielded as it arrives.
    """
    te = headers.get("transfer-encoding", "").lower()
    if "chunked" in te:
        while True:
            line, _ = reader.read_line()
            size_field = line.split(b";")[0].strip()
            if not size_field:
                continue
            size = int(size_field, 16)
            if size == 0:
                while True:  # trailers
                    tl, _ = reader.read_line()
                    if tl in (b"\r\n", b"\n"):
                        break
                return
            data, t = reader.read_exact(size)
            reader.read_exact(2)  # CRLF
            yield data, t
        return

    cl = headers.get("content-length")
    if cl is not None:
        remaining = int(cl)
        while remaining > 0:
            n = min(remaining, reader.bufsize)
            data, t = reader.read_exact(n)
            remaining -= len(data)
            yield data, t
        return

    while True:
        try:
            reader._fill()
        except (Eof, OSError):
            break
        if reader.buf:
            data = bytes(reader.buf)
            reader.buf.clear()
            yield data, reader.last_recv_t


# --------------------------------------------------------------------------
# SSE demultiplexer, timestamping each event by the flush that completed it
# --------------------------------------------------------------------------


class SSEDemux:
    def __init__(self):
        self.buf = bytearray()
        self.marks = []      # (cumulative_end_offset, arrival_ts)
        self.consumed = 0    # bytes already popped off the front of buf

    def feed(self, data, t):
        self.buf.extend(data)
        self.marks.append((self.consumed + len(self.buf), t))

    def _ts_for(self, abs_end):
        for end, t in self.marks:
            if end >= abs_end:
                return t
        return self.marks[-1][1] if self.marks else None

    def events(self):
        while True:
            idx, sep = -1, 0
            for cand in (b"\r\n\r\n", b"\n\n"):
                j = self.buf.find(cand)
                if j >= 0 and (idx < 0 or j < idx):
                    idx, sep = j, len(cand)
            if idx < 0:
                return
            block = bytes(self.buf[:idx])
            abs_end = self.consumed + idx + sep
            t = self._ts_for(abs_end)
            del self.buf[:idx + sep]
            self.consumed += idx + sep
            self.marks = [(e, mt) for e, mt in self.marks if e > self.consumed]
            payload = []
            for raw in block.replace(b"\r\n", b"\n").split(b"\n"):
                if raw.startswith(b":"):      # comment, e.g. DashScope ":HTTP_STATUS/200"
                    continue
                if raw.startswith(b"data:"):
                    payload.append(raw[5:].lstrip())
            if payload:
                yield b"\n".join(payload), t


def dig_audio_b64(obj):
    """Primary path per docs: output.audio.data. Fallback: any {"audio": {"data": ...}}.

    The fallback exists because the SSE field path could not be confirmed against a
    live response here; `audio_path` is recorded per sentence so the first real run
    settles it.
    """
    try:
        v = obj["output"]["audio"]["data"]
        if isinstance(v, str) and v:
            return v, "output.audio.data"
    except (KeyError, TypeError):
        pass

    try:
        v = obj["choices"][0]["delta"]["audio"]["data"]
        if isinstance(v, str) and v:
            return v, "choices[0].delta.audio.data"
    except (KeyError, IndexError, TypeError):
        pass

    found = []

    def walk(node, path):
        if isinstance(node, dict):
            for k, v in node.items():
                p = f"{path}.{k}" if path else k
                if k == "data" and isinstance(v, str) and v and path.endswith("audio"):
                    found.append((v, p))
                walk(v, p)
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, f"{path}[{i}]")

    walk(obj, "")
    return found[0] if found else (None, None)


# --------------------------------------------------------------------------
# Per-vendor request construction
# --------------------------------------------------------------------------


def build_request(vendor, text, cfg):
    if vendor == "siliconflow":
        body = {
            "model": cfg["sf_model"],
            "input": text,
            "voice": cfg["sf_voice"],
            "response_format": "pcm",
            "sample_rate": cfg["sample_rate"],
            "stream": True,
        }
        headers = {
            "Authorization": "Bearer " + cfg["sf_key"],
            "Content-Type": "application/json",
        }
        return SF_HOST, SF_PATH, headers, json.dumps(body, ensure_ascii=False).encode("utf-8")

    if vendor == "mimo":
        # The text to speak goes in an *assistant* message. A user message would be
        # read as a style instruction and never spoken.
        body = {
            "model": cfg["mimo_model"],
            "messages": [{"role": "assistant", "content": text}],
            "audio": {"format": cfg["mimo_format"], "voice": cfg["mimo_voice"]},
            "stream": True,
        }
        headers = {
            "Authorization": "Bearer " + cfg["mimo_key"],
            "Content-Type": "application/json",
        }
        return MIMO_HOST, MIMO_PATH, headers, json.dumps(body, ensure_ascii=False).encode("utf-8")

    body = {
        "model": cfg["ds_model"],
        "input": {
            "text": text,
            "voice": cfg["ds_voice"],
            "language_type": cfg["ds_language_type"],
        },
    }
    headers = {
        "Authorization": "Bearer " + cfg["ds_key"],
        "Content-Type": "application/json",
        "X-DashScope-SSE": "enable",
    }
    return DS_HOST, DS_PATH, headers, json.dumps(body, ensure_ascii=False).encode("utf-8")


# Content moderation is a corpus result, not a transport failure, so it gets its own
# class. DashScope says DataInspectionFailed; Mimo follows the OpenAI error shape and
# moderates both the input text and the synthesised output.
MODERATION_MARKERS = (
    "datainspectionfailed",
    "data_inspection_failed",
    "content_filter",
    "content_policy",
    "contentpolicy",
    "risk_control",
    "sensitive",
    "moderation",
    "内容安全",
    "内容审核",
    "违规",
)


def classify_error(status, body_bytes):
    """Split content-moderation refusals out of real HTTP/transport errors.

    Both vendors can bury the payload one level down: DashScope puts code/message at
    the top level, Mimo nests them under "error"."""
    text = body_bytes.decode("utf-8", "replace")
    code = msg = None
    try:
        j = json.loads(text)
        if isinstance(j, dict):
            err = j.get("error") if isinstance(j.get("error"), dict) else None
            src = err if err else j
            code = src.get("code") or src.get("type")
            msg = src.get("message")
    except (ValueError, AttributeError):
        pass
    blob = f"{code} {msg} {text}".lower()
    if any(m in blob for m in MODERATION_MARKERS):
        return "content_rejected", code, msg or text[:300]
    return "http_error", code, msg or text[:300]


# --------------------------------------------------------------------------
# One measured sentence
# --------------------------------------------------------------------------


def measure(vendor, idx, text, cfg, conn=None):
    host, path, headers, body = build_request(vendor, text, cfg)
    sample_rate = sample_rate_for(vendor, cfg)
    bytes_per_ms = sample_rate * 2 / 1000.0

    rec = {
        "vendor": vendor,
        "index": idx,
        "text": text,
        "text_chars": len(text),
        "sample_rate": sample_rate,
        "reused_conn": conn is not None,
        "status": None,
        "outcome": None,
    }

    try:
        if conn is None:
            sock, ct = open_connection(host, 443, cfg["timeout"], cfg["mark"], cfg["resolve"].get(host))
            reader = TimedReader(sock)
            rec.update({k: v for k, v in ct.items() if k.endswith("_ms") or k == "peer_ip"})
            t_start = ct["t_start"]
        else:
            sock, reader = conn
            rec.update({"dns_ms": 0.0, "tcp_ms": 0.0, "tls_ms": 0.0, "connect_total_ms": 0.0})
            t_start = CLOCK.now()

        t_sent = send_request(sock, host, path, headers, body, keep_alive=conn is not None or cfg["reuse"])
        status, resp_headers, t_head = read_response_head(reader)
        rec["status"] = status
        rec["ttfb_headers_ms"] = ms(t_sent, t_head)

        if status != 200:
            buf = bytearray()
            for data, _t in iter_body(reader, resp_headers):
                buf.extend(data)
                if len(buf) > 65536:
                    break
            outcome, code, msg = classify_error(status, bytes(buf))
            rec.update({"outcome": outcome, "error_code": code, "error_message": msg})
            if conn is None:
                sock.close()
            return rec, None

        first_pcm_bytes = None
        t_first_bytes = t_first_pcm = None
        total_pcm = 0
        frames = []          # (audio_ms, offset_from_send_ms)
        audio_path = None

        if vendor == "siliconflow":
            for data, t in iter_body(reader, resp_headers):
                if not data:
                    continue
                if first_pcm_bytes is None:
                    first_pcm_bytes = len(data)
                    t_first_bytes = t_first_pcm = t
                total_pcm += len(data)
                frames.append((len(data) / bytes_per_ms, ms(t_sent, t)))
            audio_path = "raw-body"
        else:
            demux = SSEDemux()
            stop = False
            for data, t in iter_body(reader, resp_headers):
                demux.feed(data, t)
                for payload, ts in demux.events():
                    if payload.strip() in (b"", b"[DONE]"):
                        continue
                    try:
                        obj = json.loads(payload.decode("utf-8"))
                    except ValueError:
                        continue
                    if isinstance(obj, dict) and (obj.get("code")
                                                  or isinstance(obj.get("error"), dict)):
                        outcome, code, msg = classify_error(400, payload)
                        # Mimo moderates the output too, so a refusal can land after
                        # some audio has already streamed. Record how much.
                        rec.update({"outcome": outcome, "error_code": code,
                                    "error_message": msg,
                                    "pcm_before_error": total_pcm})
                        stop = True
                        break
                    b64, p = dig_audio_b64(obj)
                    if not b64:
                        continue          # final frame carries an empty data + a url
                    audio_path = audio_path or p
                    if t_first_bytes is None:
                        t_first_bytes = ts
                    pcm = base64.b64decode(b64)
                    t_dec = CLOCK.now()
                    if not pcm:
                        continue
                    if first_pcm_bytes is None:
                        first_pcm_bytes = len(pcm)
                        t_first_pcm = t_dec
                        rec["first_frame_b64_decode_ms"] = ms(ts, t_dec)
                    total_pcm += len(pcm)
                    frames.append((len(pcm) / bytes_per_ms, ms(t_sent, t_dec)))
                if stop:
                    break
            if stop:
                if conn is None:
                    sock.close()
                return rec, None

        t_done = CLOCK.now()
        if conn is None:
            sock.close()

        if not total_pcm:
            rec.update({"outcome": "empty_audio"})
            return rec, None

        audio_ms = total_pcm / bytes_per_ms
        first_ms = first_pcm_bytes / bytes_per_ms
        synth_ms = ms(t_sent, t_done)

        rec.update({
            "outcome": "ok",
            "audio_path": audio_path,
            "frames": len(frames),
            "first_frame_bytes": first_pcm_bytes,
            "total_pcm_bytes": total_pcm,
            "first_frame_bytes_ms": ms(t_sent, t_first_bytes),
            "first_pcm_ms": ms(t_sent, t_first_pcm),
            "first_pcm_e2e_ms": ms(t_start, t_first_pcm),
            "complete_ms": ms(t_sent, t_done),
            "complete_e2e_ms": ms(t_start, t_done),
            "first_frame_audio_ms": first_ms,
            "audio_total_ms": audio_ms,
            "first_frame_ratio": first_ms / audio_ms,
            "rtf": synth_ms / audio_ms,
            "mean_frame_audio_ms": statistics.fmean(f[0] for f in frames),
        })
        return rec, ((sock, reader) if cfg["reuse"] and conn is None else conn)

    except Exception as e:  # transport failure; recorded, never retried
        rec.update({"outcome": "error", "error_code": type(e).__name__, "error_message": str(e)[:300]})
        try:
            sock.close()          # a reused connection is not trustworthy after a failure
        except (NameError, OSError):
            pass
        return rec, None


# --------------------------------------------------------------------------
# Dry-run fake transport: replays a scripted response over the virtual clock
# --------------------------------------------------------------------------


class FakeSocket:
    def __init__(self, script):
        self.script = list(script)  # [(delay_s, bytes)]
        self.sent = b""

    def sendall(self, b):
        self.sent += b

    def recv(self, n):
        if not self.script:
            return b""
        delay, data = self.script.pop(0)
        CLOCK.advance(delay)
        if len(data) > n:
            self.script.insert(0, (0.0, data[n:]))
            data = data[:n]
        return data

    def close(self):
        pass

    def settimeout(self, t):
        pass


def fake_script(vendor, text, sample_rate, idx, scenario="stream"):
    """Synthetic but shaped like the real thing: ~180 ms of speech per character.

    scenario="stream"   ~120 ms frames after a first-packet delay (true streaming)
    scenario="buffered" one flush carrying the whole sentence (fake streaming)
    """
    audio_ms = max(400.0, len(text) * 180.0)
    bpm = sample_rate * 2 / 1000.0
    if scenario == "buffered":
        frame_ms = audio_ms
        nframes = 1
    else:
        frame_ms = 120.0
        nframes = max(2, int(audio_ms / frame_ms))
    frame_bytes = int(frame_ms * bpm) & ~1

    if vendor == "mimo" and idx == 7:  # exercise the nested-error moderation path
        head = (b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n"
                b"Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n")
        ev = {"error": {"message": "Content flagged by the safety system.",
                        "type": "content_filter", "code": "content_filter"}}
        raw = b"data:" + json.dumps(ev).encode() + b"\n\n"
        return [(0.230, head), (0.020, b"%x\r\n" % len(raw) + raw + b"\r\n")]

    if vendor == "mimo":
        head = (b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n"
                b"Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n")
        script = [(0.200, head)]
        first = True
        for i in range(nframes):
            pcm = b"\x55\x66" * (frame_bytes // 2)
            ev = {"id": "chatcmpl-fake-%d" % idx, "object": "chat.completion.chunk",
                  "model": "mimo-v2.5-tts",
                  "choices": [{"index": 0, "delta": {"audio": {
                      "data": base64.b64encode(pcm).decode()}}, "finish_reason": None}]}
            raw = b"data:" + json.dumps(ev).encode() + b"\n\n"
            script.append(((0.280 if scenario == "stream" else audio_ms / 1000.0 * 0.5)
                           if first else 0.060,
                           b"%x\r\n" % len(raw) + raw + b"\r\n"))
            first = False
        script.append((0.030, b"%x\r\n" % len(b"data:[DONE]\n\n") + b"data:[DONE]\n\n" + b"\r\n"))
        script.append((0.005, b"0\r\n\r\n"))
        return script

    if vendor == "dashscope" and idx == 7:  # exercise the content-inspection path
        body = json.dumps({
            "code": "DataInspectionFailed",
            "message": "Input data may contain inappropriate content.",
            "request_id": "fake-req-%d" % idx,
        }).encode()
        head = (b"HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\n"
                b"Content-Length: %d\r\nConnection: close\r\n\r\n" % len(body))
        return [(0.240, head), (0.001, body)]

    if vendor == "siliconflow":
        head = (b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\n"
                b"Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n")
        script = [(0.185, head)]
        first = True
        for _ in range(nframes):
            payload = b"\x11\x22" * (frame_bytes // 2)
            script.append(((0.195 if scenario == "stream" else audio_ms / 1000.0 * 0.5)
                           if first else 0.055,
                           b"%x\r\n" % len(payload) + payload + b"\r\n"))
            first = False
        script.append((0.010, b"0\r\n\r\n"))
        return script

    head = (b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n"
            b"Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n")
    script = [(0.210, head)]
    first = True
    for i in range(nframes):
        pcm = b"\x33\x44" * (frame_bytes // 2)
        ev = {"output": {"audio": {"data": base64.b64encode(pcm).decode(),
                                   "expires_at": 1790000000}, "finish_reason": "null"},
              "usage": {"characters": len(text)}, "request_id": "fake-req-%d" % idx}
        raw = (b"id:%d\nevent:result\n:HTTP_STATUS/200\ndata:" % (i + 1)
               + json.dumps(ev).encode() + b"\n\n")
        script.append(((0.310 if scenario == "stream" else audio_ms / 1000.0 * 0.5)
                       if first else 0.065,
                       b"%x\r\n" % len(raw) + raw + b"\r\n"))
        first = False
    final = {"output": {"audio": {"data": "", "url": "https://dashscope-result.oss-cn-beijing.aliyuncs.com/fake.wav",
                                  "expires_at": 1790000000}, "finish_reason": "stop"},
             "usage": {"characters": len(text)}, "request_id": "fake-req-%d" % idx}
    raw = b"id:%d\nevent:result\ndata:" % (nframes + 1) + json.dumps(final).encode() + b"\n\n"
    script.append((0.040, b"%x\r\n" % len(raw) + raw + b"\r\n"))
    script.append((0.005, b"0\r\n\r\n"))
    return script


def measure_fake(vendor, idx, text, cfg):
    sample_rate = sample_rate_for(vendor, cfg)
    sock = FakeSocket(fake_script(vendor, text, sample_rate, idx, cfg["dry_scenario"]))

    real_open = globals()["open_connection"]

    def fake_open(host, port, timeout, mark=None, resolve_ip=None):
        t0 = CLOCK.now()
        CLOCK.advance(0.012)
        t_dns = CLOCK.now()
        CLOCK.advance(0.021)
        t_tcp = CLOCK.now()
        CLOCK.advance(0.048)
        t_tls = CLOCK.now()
        return sock, {"peer_ip": "203.0.113.7", "dns_ms": ms(t0, t_dns), "tcp_ms": ms(t_dns, t_tcp),
                      "tls_ms": ms(t_tcp, t_tls), "connect_total_ms": ms(t0, t_tls),
                      "t_start": t0, "t_connected": t_tls}

    globals()["open_connection"] = fake_open
    try:
        rec, _ = measure(vendor, idx, text, cfg, conn=None)
    finally:
        globals()["open_connection"] = real_open
    rec["simulated"] = True
    return rec, None


# --------------------------------------------------------------------------
# Stats & reporting
# --------------------------------------------------------------------------

SEGMENTS = [
    ("dns_ms", "DNS 解析"),
    ("tcp_ms", "TCP 连接"),
    ("tls_ms", "TLS 握手"),
    ("ttfb_headers_ms", "请求→响应头"),
    ("first_pcm_ms", "请求→首帧 PCM"),
    ("first_pcm_e2e_ms", "起点→首帧 PCM (端到端)"),
    ("complete_ms", "请求→整句收全"),
]

DERIVED = [
    ("first_frame_audio_ms", "首帧含音频 (ms)"),
    ("mean_frame_audio_ms", "平均每帧音频 (ms)"),
    ("audio_total_ms", "整句音频时长 (ms)"),
    ("first_frame_ratio", "首帧/整句 占比"),
    ("rtf", "RTF (合成耗时/音频时长)"),
]


def pctl(vals, q):
    if not vals:
        return None
    v = sorted(vals)
    if len(v) == 1:
        return v[0]
    pos = q * (len(v) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (pos - lo)


def summarize(recs):
    ok = [r for r in recs if r.get("outcome") == "ok"]
    stats = {}
    for key, _ in SEGMENTS + DERIVED:
        vals = [r[key] for r in ok if isinstance(r.get(key), (int, float))]
        if vals:
            stats[key] = {"p50": pctl(vals, .5), "p90": pctl(vals, .9),
                          "min": min(vals), "max": max(vals), "n": len(vals)}
    return {
        "n_total": len(recs),
        "n_ok": len(ok),
        "n_content_rejected": sum(1 for r in recs if r.get("outcome") == "content_rejected"),
        "n_http_error": sum(1 for r in recs if r.get("outcome") == "http_error"),
        "n_error": sum(1 for r in recs if r.get("outcome") == "error"),
        "rejected_indices": [r["index"] for r in recs if r.get("outcome") == "content_rejected"],
        "rejected_texts": [r["text"] for r in recs if r.get("outcome") == "content_rejected"],
        "stats": stats,
    }


def fmt(v, key):
    if v is None:
        return "-"
    if key in ("first_frame_ratio", "rtf"):
        return f"{v:.3f}"
    return f"{v:.1f}"


def print_report(results, meta):
    vendors = [v for v in VENDORS if v in results]
    W = 26
    COLW = 34
    line = "=" * (W + 2 + (COLW + 2) * len(vendors))
    print()
    print(line)
    print("TTS 首包延迟测量  label=%s  %s" % (meta["label"], meta["timestamp_iso"]))
    print("平台: Linux 桌面 (%s)。iPhone 上的绝对延迟会不同；" % meta["platform"])
    print("      但「首帧含多少毫秒音频」是服务端行为，与客户端在哪无关，此处测得即作数。")
    print("网络: %s" % meta["network"]["note"])
    print("连接: %s" % ("复用单连接 (对照组)" if meta["reuse_conn"] else "每句新建连接"))
    if meta["dry_run"]:
        print("模式: DRY-RUN (%s) — 数据为本地构造，仅验证解析与统计路径，不是真实测量。"
              % meta["dry_scenario"])
    print(line)

    header = "分段".ljust(W) + "".join(("  " + v).ljust(COLW + 2) for v in vendors)
    print(header)
    print("".ljust(W) + "".join("  " + "p50 / p90 / min / max".ljust(COLW) for _ in vendors))
    print("-" * len(line))

    def row(key, label):
        cells = []
        for v in vendors:
            st = results[v]["summary"]["stats"].get(key)
            if not st:
                cells.append("  " + "-".ljust(COLW))
            else:
                cells.append("  " + " / ".join(fmt(st[k], key) for k in ("p50", "p90", "min", "max")).ljust(COLW))
        print(label.ljust(W) + "".join(cells))

    for key, label in SEGMENTS:
        row(key, label)
    print("-" * len(line))
    for key, label in DERIVED:
        row(key, label)
    print("-" * len(line))

    for v in vendors:
        s = results[v]["summary"]
        print("%s: ok=%d  内容审核拒绝=%d  HTTP 错误=%d  传输错误=%d  (共 %d 句)"
              % (v, s["n_ok"], s["n_content_rejected"], s["n_http_error"], s["n_error"], s["n_total"]))
        if s["rejected_texts"]:
            for i, t in zip(s["rejected_indices"], s["rejected_texts"]):
                print("    被拒 #%d: %s" % (i, t))
        paths = {r.get("audio_path") for r in results[v]["records"] if r.get("audio_path")}
        if paths:
            print("    音频字段路径: %s" % ", ".join(sorted(paths)))
        print("    本轮送出字符数: %d" % sum(r["text_chars"] for r in results[v]["records"]))

    print(line)
    print("判据:")
    for v in vendors:
        st = results[v]["summary"]["stats"]
        ratio = st.get("first_frame_ratio", {}).get("p50")
        rtf = st.get("rtf", {}).get("p50")
        ff = st.get("first_frame_audio_ms", {}).get("p50")
        e2e = st.get("first_pcm_e2e_ms", {}).get("p50")
        if ratio is None:
            print("  %s: 无可用样本。" % v)
            continue
        verdict = []
        if ratio > 0.8:
            verdict.append("首帧即整句 (%.0f%%) — 服务端整句缓冲，按句接力拿不到收益。" % (ratio * 100))
        elif ratio > 0.4:
            verdict.append("首帧含 %.0f%% 整句 — 分块很粗，接力收益有限。" % (ratio * 100))
        else:
            verdict.append("首帧仅 %.0f ms 音频 (%.0f%%) — 真流式，接力成立。" % (ff, ratio * 100))
        if rtf is not None:
            verdict.append("RTF %.2f %s" % (rtf, "— 合成快于播放，接力不会饿死。" if rtf < 0.7
                                            else "— 接近或超过 1，接力会饿死。"))
        if e2e is not None:
            verdict.append("端到端首字 %.0f ms。" % e2e)
        print("  %s: %s" % (v, " ".join(verdict)))
    print(line)
    print()


# --------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(description="TTS first-packet latency benchmark (throwaway).")
    ap.add_argument("--vendor", choices=["siliconflow", "dashscope", "mimo", "both", "all"],
                    default="all", help='"both" is the original two vendors; "all" adds mimo')
    ap.add_argument("--n", type=int, default=40, help="sentences from the corpus (max %d)" % len(CORPUS))
    ap.add_argument("--label", default="wifi", help="network-environment tag for the filenames")
    ap.add_argument("--reuse-conn", action="store_true",
                    help="control group: one connection for all sentences instead of a fresh one per sentence")
    ap.add_argument("--dry-run", action="store_true",
                    help="no network; replay constructed responses through the full parse+timing path")
    ap.add_argument("--dry-scenario", choices=["stream", "buffered"], default="stream",
                    help="dry-run shape: real per-frame streaming, or whole-sentence buffering")
    ap.add_argument("--sample-rate", type=int, default=24000,
                    choices=[8000, 16000, 24000, 32000, 44100],
                    help="SiliconFlow pcm sample rate (DashScope is fixed at 24000)")
    ap.add_argument("--sf-voice", default=SF_VOICE)
    ap.add_argument("--sf-model", default=SF_MODEL)
    ap.add_argument("--ds-voice", default=DS_VOICE)
    ap.add_argument("--ds-model", default=DS_MODEL)
    ap.add_argument("--mimo-voice", default=MIMO_VOICE, help="冰糖 / 茉莉 / 苏打 / 白桦")
    ap.add_argument("--mimo-model", default=MIMO_MODEL)
    ap.add_argument("--mimo-format", default=MIMO_FORMAT)
    ap.add_argument("--ds-language-type", default="Chinese",
                    choices=["Auto", "Chinese", "English", "German", "Italian", "Portuguese",
                             "Spanish", "Japanese", "Korean", "French", "Russian"])
    ap.add_argument("--timeout", type=float, default=30.0)
    ap.add_argument("--mark", type=lambda s: int(s, 0), default=None,
                    help="SO_MARK to escape a Mihomo/Clash TUN (e.g. 0x80000). Needs CAP_NET_ADMIN.")
    ap.add_argument("--resolve", action="append", default=[], metavar="HOST:IP",
                    help="pin a real IP, bypassing fake-ip DNS. Repeatable.")
    ap.add_argument("--env-file", default=DEFAULT_ENV_FILE,
                    help="dotenv fallback for the two API keys; the environment wins (default: %(default)s)")
    ap.add_argument("--outdir", default=os.path.dirname(os.path.abspath(__file__)))
    args = ap.parse_args()

    global CLOCK
    if args.dry_run:
        CLOCK = VirtualClock()

    if args.vendor == "all":
        vendors = list(VENDORS)
    elif args.vendor == "both":
        vendors = ["siliconflow", "dashscope"]
    else:
        vendors = [args.vendor]
    sentences = CORPUS[:min(args.n, len(CORPUS))]

    resolve = {}
    for item in args.resolve:
        h, _, ip = item.partition(":")
        resolve[h.strip()] = ip.strip()

    probe_hosts = [VENDOR_HOSTS[v] for v in vendors]
    network = detect_network(probe_hosts)
    if not args.dry_run:
        print(network["note"], file=sys.stderr)
        if network["state"] == "transparent-tun" and not (args.mark or resolve):
            print("警告: 数据会被隧道污染。先把这两个域名加进 Mihomo 的 DIRECT 规则，"
                  "或用 --mark 0x80000 (需 root) / --resolve HOST:IP。", file=sys.stderr)

    dotenv = load_env_file(args.env_file)
    keys, key_sources = {}, {}
    for v in vendors:
        var = KEY_VARS[v]
        keys[v], key_sources[v] = resolve_key(var, dotenv)
        if not args.dry_run:
            if not keys[v]:
                print("%s 没找到：环境变量和 %s 里都没有。见 README。" % (var, args.env_file),
                      file=sys.stderr)
                return 2
            print("%s 来自 %s" % (var, {"env": "环境变量", "dotenv": args.env_file}[key_sources[v]]),
                  file=sys.stderr)

    cfg = {
        "sample_rate": args.sample_rate,
        "sf_key": keys.get("siliconflow", ""), "sf_voice": args.sf_voice, "sf_model": args.sf_model,
        "ds_key": keys.get("dashscope", ""), "ds_voice": args.ds_voice, "ds_model": args.ds_model,
        "ds_language_type": args.ds_language_type,
        "mimo_key": keys.get("mimo", ""), "mimo_voice": args.mimo_voice,
        "mimo_model": args.mimo_model, "mimo_format": args.mimo_format,
        "timeout": args.timeout, "mark": args.mark, "resolve": resolve,
        "reuse": args.reuse_conn, "dry_scenario": args.dry_scenario,
    }

    ts = int(time.time())
    ts_iso = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts))
    os.makedirs(args.outdir, exist_ok=True)

    meta = {
        "label": args.label, "timestamp": ts, "timestamp_iso": ts_iso,
        "platform": "linux-desktop", "reuse_conn": args.reuse_conn, "dry_run": args.dry_run, "dry_scenario": args.dry_scenario,
        "network": network, "key_sources": key_sources,
        "env_file": args.env_file, "sample_rate_siliconflow": args.sample_rate,
        "sample_rate_dashscope": DS_SAMPLE_RATE, "sample_rate_mimo": MIMO_SAMPLE_RATE,
        "voices": {"siliconflow": args.sf_voice, "dashscope": args.ds_voice, "mimo": args.mimo_voice},
        "models": {"siliconflow": args.sf_model, "dashscope": args.ds_model, "mimo": args.mimo_model},
        "n": len(sentences),
        "total_chars": sum(len(s) for s in sentences),
    }

    # Sentence-outer, vendor-inner: the vendors take turns rather than each taking a
    # solid block of the run, so a drifting network is a shared term instead of a bias
    # towards whoever went first.
    records = {v: [] for v in vendors}
    conns = {v: None for v in vendors}
    for i, text in enumerate(sentences):
        for v in vendors:
            if args.dry_run:
                rec, _ = measure_fake(v, i, text, cfg)
            else:
                rec, conns[v] = measure(v, i, text, cfg,
                                        conn=conns[v] if args.reuse_conn else None)
            records[v].append(rec)
            if not args.dry_run:
                mark = {"ok": "ok", "content_rejected": "REJECTED"}.get(rec["outcome"], rec["outcome"])
                print("  [%-11s %2d/%d] %s  first_pcm=%s ms  ff_audio=%s ms"
                      % (v, i + 1, len(sentences), mark,
                         fmt(rec.get("first_pcm_ms"), "x"), fmt(rec.get("first_frame_audio_ms"), "x")),
                      file=sys.stderr)
    for v in vendors:
        if conns[v]:
            try:
                conns[v][0].close()
            except OSError:
                pass

    results = {}
    for v in vendors:
        recs = records[v]
        results[v] = {"records": recs, "summary": summarize(recs)}

        path = os.path.join(args.outdir, "raw-%s-%s-%d.jsonl" % (v, args.label, ts))
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps({"_meta": meta, "_vendor": v}, ensure_ascii=False) + "\n")
            for r in recs:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
            f.write(json.dumps({"_summary": results[v]["summary"]}, ensure_ascii=False) + "\n")
        print("wrote %s" % path, file=sys.stderr)

    print_report(results, meta)
    return 0


if __name__ == "__main__":
    sys.exit(main())
