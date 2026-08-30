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

## Speaking

The other half, and the newer one: `src/tts` turns a sentence into PCM. Mimo's
`mimo-v2.5-tts` over SSE, base64 inside `choices[0].delta.audio.data`,
24 kHz / 16-bit / mono, the text to speak in an **assistant** message — a user
message would be read as a style instruction and never spoken (docs/33).

It is here rather than in the app crate because this plugin owns the audio: the
PCM is headed for an `AVAudioPlayerNode` on the same voice-processing engine
`AudioFront` already holds, and producer and consumer in one crate is a function
call instead of a cross-crate contract and a second ACL namespace. Nothing in it
is iOS-only. It compiles and makes real requests on the Linux desktop, which is
the only place any of it can be measured, and everything below was.

```
TtsBackend        one vendor. MimoBackend is the only one; qwen3-tts-flash is
                  the named alternate and fits the same shape.
SilenceTrimmer    streaming head and tail trim, pushed bytes in, playable bytes
                  out.
SpeechRelay       sentences in, trimmed audio to the player in order, working
                  far enough ahead that playback never runs dry.
Player            where finished audio goes. DevicePlayer is the phone;
                  VirtualPlayer keeps the clock and throws the audio away, which
                  is how the relay is measured.
OpeningCache      one slot for the sentence that is known before it is asked
                  for.
```

The Swift half below is what consumes it. `Player` is the Rust-side shape of
that hand-off, `DevicePlayer` (`src/speaker.rs`) is the implementation that
calls `Voice::enqueue_speech` and `stop_speaking`, and `VirtualPlayer` is the
same shape with the audio thrown away, which is how the relay was measured
without a phone. Off iOS `Voice` rejects both, so `DevicePlayer` compiles
everywhere and speaks only where there is something to speak through.

### What the Swift half has to do

`Player` is the whole contract, and it has three calls.

`enqueue(sentence)` takes one finished sentence — `id`, `chars`, whether it is
the turn's `last`, the audio format, and PCM that is already trimmed and already
carries the pause that goes after it. `last` is there because a player cannot
work it out: a turn that ended and a turn that starved both look like a queue
running dry. It schedules a buffer on the player node and returns immediately, and
it answers with **how much audio is queued ahead of the playhead**, in
milliseconds, counting the one just added. That number is the only feedback the
relay gets and the only thing it needs: it is what says whether there is time to
synthesise another sentence or whether the speaker is about to run out. It is
not a sentence count, because sentences run from three characters to forty and a
count says nothing about how long the player can keep going.

`state()` is the same answer for the stretch where no sentence is being handed
over, and there is no command behind it: Rust keeps the last margin it was given
and subtracts the wall clock, which is what playback does anyway. Asking the
phone would be a round trip for a number that is already known.

`stop()` drops every scheduled buffer that has not been heard and answers with
where the user was interrupted: the sentence id, how far into it the playhead
was, and that sentence's whole length. The caller turns the pair into a
character offset — `chars` came in with the audio for exactly that — which is how
the assistant's message gets truncated to what was actually heard (docs/33,
docs/27). `playerTime` on the node is the authority for that position; Rust's
side of the queue models it well enough to schedule against, never well enough
to truncate a transcript with.

Rust does not poll. Every enqueue refreshes the margin, and between enqueues it
decays with the wall clock, which is what playback does anyway.

The relay hands over whole sentences, not chunks. Within a sentence the trim
streams — audio goes out while the rest is still arriving — but nothing leaves
the relay until the sentence is complete, because the tail cannot be trimmed
before the end of it is known.

The same engine also speaks (`docs/33`, M-voice-2). An `AVAudioPlayerNode` is
attached to the stack the microphone already keeps and connected to the main
mixer at 24 kHz mono float32; sentences are queued onto it one at a time and
play end to end with no gap inserted between them.

| command | arguments | answer |
|---|---|---|
| `stop_speaking` | optional `reason` | `{ speaking, utterance, index, charOffset, playedMs }` |
| `speech_probe` | `args` object, debug builds only | — (or the interruption leg's positions) |
| `speech_live` | `args` object, debug builds only | the relay's timeline for that turn |
| `speech_report` | — | the last bench run's measurements |

`speech_probe` also carries the turn probe, under the `mode` names `turn-start`,
`turn-stage`, `turn-finalize` and `turn-stop` (docs/33, M-voice-3). One pass is
one microphone, one `SpeechAnalyzer` with a `SpeechDetector` in its module list,
and every event on one clock: a record per tap buffer with the raw linear RMS on
it, every detector result, every transcript result, the stage names the harness
supplies and every forced `finalize(through: nil)` with what the volatile tail
was at the moment of the call. `turn-stop` answers with the whole of it.
Debug builds only, and it measures without deciding: no threshold, no turn
detector, no barge-in. `src/smoke/turn-probe.ts` drives it.

`speech_probe` plays sentences synthesised days ago and measures the player;
`speech_live` is the same twelve sentences through the vendor, the trim and the
relay, which is the only path that runs every stage at once. It takes its key
from the process environment (`MIMO_API_KEY`) rather than an argument or a file,
resolves when the last sentence has been queued rather than when the voice
stops, and is a debug build's tool on both counts.

`enqueue_speech` is deliberately **not** a command. Sentences are put on the
queue from Rust, through `Voice::enqueue_speech`, because the synthesiser lives
there: making it a command would carry the PCM into the webview and straight
back out. Its shape is the contract between the two halves:

| Rust sends | |
|---|---|
| `utterance` | one number per turn of conversation, increasing |
| `index` | sentence number within the turn, from 0 |
| `chars` | how many characters that sentence is. Never the text — nothing native has ever held a word anybody said, and this does not start |
| `last` | this is the turn's final sentence |
| `sampleRate` | 24000. Anything else is refused with both numbers, never resampled |
| `pcm` | base64 of little-endian 16-bit mono, already trimmed and already carrying the pause after the sentence |

| Swift answers | |
|---|---|
| `dropped` | the turn was stopped before this sentence arrived; it was not queued |
| `queuedMs` | speech now ahead of the listener — the whole queue minus what has been played, not the running total |
| `startMs` | where this sentence starts on the player's timeline |

Queueing, timekeeping and interruption are Swift's. Trimming is not: the
threshold is a property of the vendor's audio — the lead-out is room tone at
-45..-65 dBFS, not silence (docs/pitfall/191) — so it belongs beside the vendor,
in `src/tts`, where it is measurable on a desktop and covered by tests. Swift
receives PCM that is already trimmed and already carries the pause that follows
the sentence, and answers with where it put it. Changing vendor changes
nothing on this side unless the new one speaks at some rate other than 24 kHz.

One more event, subscribed with `addPluginListener('voice', 'speech', cb)`:

| payload | when |
|---|---|
| `{ kind: "level", value }` | output level 0..1 for the orb, about 10 Hz, and one final `0` as the voice stops |
| `{ kind: "speaking", value, reason }` | `1` when a turn starts; `0` when it ends, with `done`, `underrun`, `interrupted`, `released` or `lost` |

A separate event name rather than a fifth `dictation` kind. The dictation
reducer has no default branch and every promise above about that event stays
exactly as it was: playback emits nothing on it, `DictationRun` is untouched,
and a composer subscribed to `dictation` cannot hear the voice at all.

What the playback path promises:

- A drained queue is a `stop()`. `scheduleBuffer` with no `when` splices buffers
  end to end, so a running frame total is the position in the speech — but the
  player's timeline keeps advancing through the trailing silence and through a
  gap where the next sentence has not arrived. Stopping on drain is what keeps
  the position honest; it covers a turn ending and a turn starving with the same
  mechanism, and only the `reason` tells them apart.
- `stop_speaking` reads the position before it stops the player, because
  stopping resets the timeline the position is measured on. `index` and
  `charOffset` map back onto the text the caller sent; the character is linear
  within the sentence, so it is worth about a character or two, and the sentence
  boundary is exact.
- Nothing resumes after an interruption. A route that went away, a session that
  was interrupted or an app that left the screen ends the turn with
  `reason: "lost"`, and what comes next is a new turn.
- **Speaking lights the orange indicator too.** It is the same engine, so the
  cost of one form is the cost of both: whoever opens a mouth owes a
  `release_microphone`. That command now stops the voice as well — an engine
  about to be torn down cannot go on speaking through.
- A dictation hold that wants no player is served by a stack that has one, so
  speaking first and then holding to talk costs no rebuild. Holding first and
  then speaking costs one, and it is recorded in `timing.reuseSkipped`.
- The end of a hold will not park the engine while a sentence is still being
  spoken; the voice's own release parks it when the turn is over.
