#!/usr/bin/env python3
# One page in WebKitGTK, the engine the desktop app's hidden webview runs on
# Linux, the way docs/84 「WebKitGTK 实测」 read X: an ephemeral context (no
# profile on disk, no cookies, signed out), the fetcher's User-Agent and
# viewport, and its Page wait: rendered text of 200 characters or more that has
# not changed over 4 polls 750 ms apart. Load events are not waited on (pitfall
# 496). Then the caller's script runs once and its value is printed as JSON:
# {"value": ..., "detail": ..., "elapsedMs": ...}.
#
# Run under xvfb-run only, never on the user's display:
#   xvfb-run -a python3 -I webkit-page.py <url> <script-file> [timeout-seconds]

import json
import sys
import time

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

# src-tauri/src/webview_fetch/policy.rs USER_AGENT and VIEWPORT.
USER_AGENT = (
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/60.5 Safari/605.1.15"
)
VIEWPORT = (1440, 900)
READY_MIN_CHARS = 200
POLL_MS = 750
STABLE_POLLS = 4

url = sys.argv[1]
with open(sys.argv[2], encoding="utf-8") as f:
    script = f.read()
timeout = float(sys.argv[3]) if len(sys.argv) > 3 else 90.0

context = WebKit2.WebContext.new_ephemeral()
view = WebKit2.WebView.new_with_context(context)
view.get_settings().set_user_agent(USER_AGENT)
window = Gtk.OffscreenWindow()
window.set_default_size(*VIEWPORT)
window.add(view)
window.show_all()

start = time.time()
state = {"last": -1, "stable": 0, "done": False, "running": False}
out = {"value": None, "detail": None, "elapsedMs": 0}


def finish(value, detail):
    if state["done"]:
        return
    state["done"] = True
    out["value"] = value
    out["detail"] = detail
    out["elapsedMs"] = int((time.time() - start) * 1000)
    Gtk.main_quit()


def evaluate(code, then):
    def done(webview, result):
        try:
            value = webview.evaluate_javascript_finish(result)
            if value is None or value.is_undefined() or value.is_null():
                then(None, None)
            else:
                then(value.to_string(), None)
        except Exception as e:  # noqa: BLE001
            then(None, str(e))

    view.evaluate_javascript(code, -1, None, None, None, done)


def run_script(why):
    if state["running"] or state["done"]:
        return
    state["running"] = True

    def got(text, err):
        if err:
            finish(None, "; ".join(filter(None, [why, f"script failed: {err}"])))
            return
        try:
            finish(json.loads(text) if text else None, why)
        except ValueError as e:
            finish(None, f"script value is not JSON: {e}")

    evaluate(f"JSON.stringify({script})", got)


def poll():
    if state["done"] or state["running"]:
        return False
    if time.time() - start > timeout:
        run_script(f"the page had not settled after {int(timeout)} s")
        return False

    def got(text, _err):
        n = int(text) if text and text.isdigit() else 0
        if n >= READY_MIN_CHARS and n == state["last"]:
            state["stable"] += 1
        else:
            state["stable"] = 0
        state["last"] = n
        if state["stable"] >= STABLE_POLLS:
            run_script(None)
        else:
            GLib.timeout_add(POLL_MS, poll)

    evaluate("String(document.body ? document.body.innerText.length : 0)", got)
    return False


def hard_stop():
    finish(None, "hard timeout")
    return False


view.load_uri(url)
GLib.timeout_add(POLL_MS, poll)
GLib.timeout_add(int((timeout + 30) * 1000), hard_stop)
Gtk.main()
print(json.dumps(out, ensure_ascii=False))
