#!/usr/bin/env python3
# Loads probe.html with the bundled marks code inlined into an offscreen
# WebKitGTK view and prints what the page leaves in window.__result.
#
# Run under xvfb-run only, never on the user's display (run.sh does):
#   xvfb-run -a python3 -I runner.py <page.html> <bundle.js>

import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

page = open(sys.argv[1]).read().replace("/*RP*/", open(sys.argv[2]).read())
win = Gtk.OffscreenWindow()
win.set_default_size(1400, 1000)
view = WebKit2.WebView()
view.set_size_request(1400, 1000)
win.add(view)
win.show_all()
status = {"code": 2}


def poll():
    def done(v, res):
        try:
            s = v.evaluate_javascript_finish(res).to_string()
        except Exception:
            s = ""
        if s:
            print(s)
            status["code"] = 0
            Gtk.main_quit()

    view.evaluate_javascript("String(window.__result || '')", -1, None, None, None, done)
    return True


def loaded(v, ev):
    if ev == WebKit2.LoadEvent.FINISHED:
        GLib.timeout_add(400, poll)


def timeout():
    print("TIMEOUT")
    Gtk.main_quit()


view.connect("load-changed", loaded)
GLib.timeout_add(30000, timeout)
view.load_html(page, "file:///tmp/")
Gtk.main()
sys.exit(status["code"])
