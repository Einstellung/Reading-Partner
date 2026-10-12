#!/usr/bin/env python3
"""Run JS in the app's WKWebView on a physical device through ios_webkit_debug_proxy.

    webview-eval.py eval '<expr>'           synchronous expression, prints the JSON result
    webview-eval.py aeval '<body>' [secs]   async function body (may await), prints its return

Needs ios_webkit_debug_proxy listening on 127.0.0.1:9222 (scripts/macos/device.sh
iwdp), an inspectable build, the app in the foreground, and websocket-client
(pip install websocket-client). Works the same from macOS or Linux.

iOS 12.2+ speaks the multi-target protocol, so every command is wrapped in
Target.sendMessageToTarget. WebKit ignores Runtime.evaluate's awaitPromise, so
aeval parks the result in window.__pv and polls for it.
"""
import json
import sys
import time
import urllib.request

import websocket

PORT = 9222


def target_ws():
    for _ in range(30):
        try:
            devs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=3))
            for p in devs:
                if p.get("url", "").startswith("tauri://") and p.get("webSocketDebuggerUrl"):
                    return p["webSocketDebuggerUrl"]
            # The device list: follow the first device's own port to its pages.
            if devs and "webSocketDebuggerUrl" not in devs[0]:
                url = devs[0]["url"].split("//")[-1]
                port = int(url.split(":")[-1])
                pages = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=3))
                for p in pages:
                    if p.get("url", "").startswith("tauri://"):
                        return p["webSocketDebuggerUrl"]
        except Exception:
            pass
        time.sleep(1)
    raise SystemExit("no tauri:// page")


class Page:
    def __init__(self):
        self.ws = websocket.create_connection(target_ws(), timeout=20)
        self.n = 0
        self.target = None
        end = time.time() + 10
        while not self.target and time.time() < end:
            m = json.loads(self.ws.recv())
            if m.get("method") == "Target.targetCreated":
                self.target = m["params"]["targetInfo"]["targetId"]
        if not self.target:
            raise SystemExit("no target")

    def send(self, method, params):
        self.n += 1
        inner = json.dumps({"id": self.n, "method": method, "params": params})
        self.ws.send(json.dumps({"id": 100000 + self.n, "method": "Target.sendMessageToTarget",
                                 "params": {"targetId": self.target, "message": inner}}))
        want = self.n
        while True:
            m = json.loads(self.ws.recv())
            if m.get("method") == "Target.dispatchMessageFromTarget":
                r = json.loads(m["params"]["message"])
                if r.get("id") == want:
                    return r

    def eval(self, expr):
        r = self.send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        res = r.get("result", {})
        if res.get("wasThrown") or "exceptionDetails" in res:
            return {"error": res.get("result", {}).get("description")}
        return res.get("result", {}).get("value")


def main():
    mode, code = sys.argv[1], sys.argv[2]
    p = Page()
    if mode == "eval":
        print(json.dumps(p.eval(code), ensure_ascii=False))
        return
    timeout = float(sys.argv[3]) if len(sys.argv) > 3 else 60
    p.eval("window.__pv = undefined; (async () => {" + code + "})()"
           ".then(v => window.__pv = JSON.stringify({ok: v}), e => window.__pv = JSON.stringify({err: String(e && e.stack || e)}))")
    end = time.time() + timeout
    while time.time() < end:
        v = p.eval("window.__pv")
        if v is not None:
            print(v)
            return
        time.sleep(0.2)
    print('{"err":"timeout"}')


main()
