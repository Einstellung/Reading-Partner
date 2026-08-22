# tauri-plugin-voice

The native half of hold-to-talk dictation (`docs/15-语音输入.md`, and the probe
this grew out of in `docs/33-语音简报.md`). iOS only: `ios/Sources` captures the
microphone through `AVAudioEngine` with the voice-processing (echo cancelling)
unit on, and transcribes it on device with `SpeechAnalyzer` +
`SpeechTranscriber`. Nothing leaves the phone and there is no key to configure.
Rust is the bridge; everywhere that is not iOS the plugin registers and rejects
the start with a sentence.

Commands, all invoked as `plugin:voice|<name>`:

| command | arguments | answer |
|---|---|---|
| `start_dictation` | optional `locale`, optional `contextualStrings` | — |
| `stop_dictation` | — | `{ transcript }` |
| `cancel_dictation` | — | — |
| `release_microphone` | — | — |

Both `start_dictation` arguments can be absent rather than null: the invoke
payload is `JSON.stringify`d and undefined properties vanish, so a book with no
glossary and no language chosen sends `{}`.

The composer normally does pass a locale, from `settings.dictationLocale`.
Without one the native side walks `Locale.preferredLanguages` and takes the
first in `SpeechTranscriber.supportedLocales`, falling back to `en-US` —
a fallback for the window before settings load, not a mode to rely on. Following
the device is what transcribes Chinese speech as confident English
(docs/pitfall/164), because cross-language decoding is total rather than
degraded. `Locale.current` is not usable for any of this (docs/33).

One event, subscribed with `addPluginListener('voice', 'dictation', cb)`:

| payload | when |
|---|---|
| `{ kind: "volatile", text }` | the un-finalized tail was re-guessed; it replaces the last volatile, and covers only what is beyond the last final |
| `{ kind: "final", text }` | a stretch settled and is appended; it also clears the tail, empty text included |
| `{ kind: "level", value }` | input level 0..1 for the meter, about 10 Hz |
| `{ kind: "timing", timing }` | the hold is down; where each step of the press went, in milliseconds. Numbers and states only, never words |

Those four `kind` values are the whole vocabulary. The webview's reducer has no
default branch, so a fifth kind leaves it holding `undefined` and the next
event throws inside a callback nothing catches — a hot microphone with a dead
handler. `text` is always present and always a string, `""` included.

Errors have one channel: rejecting a command. Tauri rejects with a plain string
and the composer renders it raw under the bar, so every rejection here is a
user-facing English sentence. A hold that recorded no speech is **not** an
error — `stop_dictation` resolves `{ transcript: "" }` and the webview shows its
own line for it.

Lifecycle the native side honours, because the webview depends on all of it:

- Nothing is emitted before `start_dictation`'s response reaches the webview.
  The hold sits in `arming` until then and drops every event that arrives first.
- Nothing is emitted after `stop_dictation` is received. The listener stays
  registered through the flush, and on a flush timeout the webview permits a new
  hold while the old one is still subscribed, so a late event would land twice
  in the next hold's transcript. The accumulator keeps working; only the
  emission stops.
- `stop_dictation` returns the whole transcript, not the flushed tail. The
  webview uses it as a replacement for the streamed text, not a supplement.
  Stretches are joined with the same CJK-aware seam rule as the webview's own
  fold, since the returned string does not pass through it.
- `cancel_dictation` is safe on a session that never produced a sample, and on
  no session at all.
- `release_microphone` resolves whatever it finds, including nothing, and is
  what ends a voice mode. See below: without it the microphone stays open.
- A run tears down from `stop_dictation` alone: unmounting during the flush
  sends no cancel.
- `start_dictation` may arrive while a previous `stop_dictation` is still
  flushing. Every command runs on one serial chain, so the new start waits out
  the old teardown rather than fighting it for the audio session.

`AVAudioEngine.start()` can return without an error and leave the engine
stopped, with the tap never called once (docs/pitfall/132), and a tap whose
format disagrees with its node is silently never called either. Both are
checked, and either one fails the start with the disagreeing numbers in the
message.

A run ends for good when the audio session is interrupted. iOS refuses to
restart recording from the background (`!rec`, docs/33), so an interruption
tears the capture down and keeps the transcript, and the following
`stop_dictation` still answers with what was said. A five-minute backstop does
the same for a hold nobody released — the webview has no duration cap at all.

The microphone's lifetime is one voice mode, not one hold. The first
`start_dictation` builds the session, the voice-processing unit, the engine and
the tap; `stop_dictation` pauses the engine rather than stopping it, and the
next `start_dictation` inherits all four. Press to first audio buffer is 1082 ms
when the stack is rebuilt every time and 304 ms when it is inherited (28 holds,
iPhone 16 / iOS 26.6), and the head of a short sentence survives 9/9 rather than
2/13. `pause()` and not `stop()` because Apple documents `stop()` as releasing
what `prepare()` allocated.

The caller owes it one thing in return. The orange microphone indicator lights
at `engine.start()` (docs/pitfall/167), so it stays lit for as long as the stack
is kept, and `release_microphone` is the only thing that puts it out. Send it the
moment voice mode ends. Nothing here releases the stack for idleness — a hold
after a long pause is exactly the one worth keeping fast.

iOS takes the microphone back on its own, and the plugin watches for three ways
it does: an interruption beginning, an input route that went empty, and the app
leaving the screen — which is the only notice a locked screen gives, since it
posts no interruption at all (docs/pitfall/162). Between holds, any of them tears
the stack down and the next hold rebuilds it. During a hold they only refuse the
keep; the run tears itself down as it always did. Either way a hold never fails
for it, and `timing.reused` says which one happened with `timing.reuseSkipped`
beside it saying why.
