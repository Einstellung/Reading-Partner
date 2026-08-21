# Driving the dictation smoke on a real iPhone

These run **on the Mac build machine**, not here. They were in `/tmp` on the
Mac, which a reboot empties — that is how the last set was lost — so they live
in the repo now and get copied over at the start of a session:

```sh
scp scripts/ios-dictation/* macmini:/tmp/
ssh macmini 'chmod +x /tmp/*.sh'
```

Machine: `ssh macmini`, user `mima1234`, repo at `~/Reading-Partner` with a
`linux` remote that fetches from the main checkout. Phone: `hu's iPhone`,
iPhone 16, iOS 26.6, UDID `00008140-000C31641EEB001C`, attached over USB.

| script | what it does |
|---|---|
| `ios-dev.sh` | build the normal app for the device and install it. `--reinit` regenerates `gen/apple` |
| `bench-run.sh` | the same, with `VITE_SMOKE=dictation-bench`, then launch. The interactive one — for a person to hold the bar |
| `smoke-run.sh` | the same, with `VITE_SMOKE=dictation`, then start the console and the speaker and launch |
| `launch-on-unlock.sh` | wait for the phone to unlock, kill any stale instance, start the console and speaker, launch |
| `syslog.sh` | `idevicesyslog` filtered to `RP-DICT` |
| `speaker.sh` | watch the console and speak into the room on each hold's cue |
| `fetch-result.sh` | pull `dictation-result.json` out of the app data container |
| `analyse.py` | print the numbers §7 of the brief asks for |

The four `VITE_SMOKE` values and who each one is for: `dictation` and
`dictation-long` are unattended and write a JSON verdict; `dictation-guided`
drives the bar on a schedule while a person reads lines aloud; `dictation-bench`
drives nothing and measures nothing — it mounts the real composer so the bar can
be held by hand, which is the only way to judge it on a build that cannot sign
in (docs/pitfall/31).

## What each one had to learn the hard way

- `codesign` from an SSH session fails with `errSecInternalComponent`, and
  neither `security unlock-keychain` nor `set-key-partition-list` helps. The
  build runs as `sudo -A launchctl asuser 501 sudo -u mima1234 <cmd>`. The inner
  `sudo -u` is not redundant: `launchctl asuser` alone runs as root, Xcode says
  `No Accounts`, and DerivedData lands in `/var/root`.
- `sudo` with no tty needs `export SUDO_ASKPASS=$HOME/.askpass.sh` then `sudo -A`.
  It is in `~/.zshenv` already, but these scripts override the environment.
- Vite's 1420 is `strictPort`; whatever holds it has to be killed first.
- `Directory not empty (os error 66)` is a stale `src-tauri/gen/apple/build`.
- `gen/apple` is gitignored and goes stale, so a tree can keep building at the
  old deployment target after `tauri.conf.json` moves. It is regenerated
  whenever the two disagree.
- macOS has no `setsid`; a detached helper needs `( nohup … & )` plus
  `< /dev/null` or it is reaped a second in and looks like a device fault.
- `devicectl device install app` does not stop the running instance. Two
  instances fight over the audio session and one of them hangs for a minute and
  a half (docs/pitfall/159), so the stale pids are killed by signal first.
- An unfiltered `idevicesyslog` drops most of what you want
  (docs/pitfall/163); `-m RP-DICT` fixes it.
- The phone must be unlocked to launch anything at all, and it auto-locks about
  two minutes later. `navigator.wakeLock` exists in the webview but is refused
  (`Permission was denied`) without user activation, so a run longer than one
  auto-lock period needs Auto-Lock set to Never on the device.

## The .dev bundle id

Local signing needs `com.xinyuan.readingpartner.dev` (the real identifier is an
explicit App ID owned by the paid team, which a Personal Team cannot claim).
`ios-dev.sh` and `smoke-run.sh` apply it with `sed` as an **uncommitted
working-tree edit in the Mac's clone** and it must never travel back: the real
identifier has Google's reversed client id baked into `CFBundleURLTypes` at
build time, owns every user's data directory, and is what the sideload and
simulator workflows assert on. Expect `git status` on the Mac to show exactly
one modified file, `src-tauri/tauri.conf.json`, and nothing else.

Signing identity present: `Apple Development: 1016180377@qq.com (H9Q4HYJ8P6)`,
team `NNXRL2S9SA`, profile `iOS Team Provisioning Profile:
com.xinyuan.readingpartner.dev`. A free Personal Team certificate expires after
seven days; this one was minted 2026-08-12 and expires 2026-08-19.

## speaker.sh is a harness, and it has limits

It plays `say` through the Mac's built-in speaker so the phone hears something.
That is enough to measure timing and the shape of the result stream — when
finals arrive, whether a volatile covers the tail or the whole utterance, what
punctuation a final carries — and it is **not** enough to measure anything about
level or accuracy. A loudspeaker at an unknown distance is not a mouth at arm's
length, and with voice processing on the phone treats the two differently by
design (docs/33's echo-cancellation round is the same experiment by accident).
Do not tune the meter's dB window against it, and do not conclude anything about
how good the transcription is.

The Mac is in a shared office. Do not run `speaker.sh` when the room is not
empty.
