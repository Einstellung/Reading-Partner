// The half of the playback check that needs ears rather than a harness: whether
// the twelve sentences, spliced end to end by the scheduler, sound like one
// stretch of speech.
//
// Three buttons, and the third is the control. The trimmed relay and the
// reference file are the same bytes in the same order — one arrives as twelve
// scheduled buffers and the other as one — so a difference heard between them
// is a difference the scheduler made. The raw relay keeps the vendor's own
// silences in, which is what "no trimming" would sound like.

import { invoke } from "@tauri-apps/api/core";
import { addPluginListener, type PluginListener } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";

type SpeechEvent = { kind: string; value: number; reason?: string };

function Bench(): React.ReactElement {
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [line, setLine] = useState("ready");
  const listener = useRef<PluginListener | null>(null);

  useEffect(() => {
    let live = true;
    void addPluginListener("voice", "speech", (event: SpeechEvent) => {
      if (!live) return;
      if (event.kind === "level") setLevel(event.value);
      if (event.kind === "speaking") {
        setSpeaking(event.value === 1);
        if (event.value === 0) setLine(`stopped: ${event.reason ?? "done"}`);
      }
    }).then((l) => {
      listener.current = l;
    });
    return () => {
      live = false;
      void listener.current?.unregister();
    };
  }, []);

  const play = async (label: string, source: "trimmed" | "raw", limit?: number) => {
    setLine(`playing ${label}`);
    try {
      const fixtureDir = await join(await appDataDir(), "speech-fixture");
      await invoke("plugin:voice|speech_probe", {
        args: { label, source, pace: "burst", fixtureDir, limit },
      });
    } catch (e) {
      setLine(String(e));
    }
  };

  const stop = async () => {
    try {
      const at = await invoke("plugin:voice|stop_speaking", { reason: "bench" });
      setLine(`stopped at ${JSON.stringify(at)}`);
    } catch (e) {
      setLine(String(e));
    }
  };

  const button = {
    display: "block",
    width: "100%",
    minHeight: "56px",
    margin: "10px 0",
    fontSize: "17px",
    borderRadius: "12px",
    border: "1px solid #bbb",
    background: "#fff",
  } as const;

  return (
    <div style={{ font: "15px/1.5 -apple-system,system-ui,sans-serif", padding: "20px" }}>
      <div style={{ fontSize: "20px", fontWeight: 700, marginBottom: "12px" }}>speech bench</div>
      <div
        style={{
          height: "10px",
          borderRadius: "5px",
          background: "#eee",
          overflow: "hidden",
          marginBottom: "14px",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.round(level * 100)}%`,
            background: speaking ? "#0a7d28" : "#bbb",
            transition: "width 75ms linear",
          }}
        />
      </div>
      <button style={button} onClick={() => void play("bench-trimmed", "trimmed")}>
        trimmed relay (12 buffers)
      </button>
      <button style={button} onClick={() => void play("bench-raw", "raw")}>
        raw relay (vendor silences, trimmed here)
      </button>
      <button style={button} onClick={() => void play("bench-short", "trimmed", 3)}>
        first three sentences
      </button>
      <button style={{ ...button, background: "#fee" }} onClick={() => void stop()}>
        stop
      </button>
      <div style={{ marginTop: "14px", fontSize: "13px", color: "#666" }}>{line}</div>
    </div>
  );
}

export function runSpeechBench(): void {
  const root = document.getElementById("root");
  if (!root) return;
  createRoot(root).render(<Bench />);
}
