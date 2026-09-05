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
| `speech-run.sh` | the playback experiments: build `VITE_SMOKE=speech`, launch once to make the data directory, push the fixture, run it and fetch the tape. `speech-run.sh speech-live` adds the leg that synthesises |
| `turn-run.sh` | the turn detector probe: build `VITE_SMOKE=turn`, push the fixture, run it. Interactive — the screen says when to read |
| `turn-replay-run.sh` | the turn detector's two implementations over the same numbers: build `VITE_SMOKE=turn-replay`, run it, print where Swift and TypeScript disagree. Nothing plays, nothing listens, nobody has to be there |
| `push-fixture.sh` | copy the pre-synthesised sentences into the app data container. Needs the app to have been launched once |
| `fetch-result.sh` | pull `dictation-result.json` out of the app data container |
| `analyse.py` | print the numbers §7 of the brief asks for |

The four `VITE_SMOKE` values and who each one is for: `dictation` and
`dictation-long` are unattended and write a JSON verdict; `dictation-guided`
drives the bar on a schedule while a person reads lines aloud; `dictation-bench`
drives nothing and measures nothing — it mounts the real composer so the bar can
be held by hand, which is the only way to judge it on a build that cannot sign
in (docs/pitfall/31).

## The whole line, once, on the phone

The fixture legs measure the player and nothing in front of it. The one run that
goes text → 小米 → trim → relay → speaker is `speech-live`, and the first command
after the phone is plugged in is:

```sh
MIMO_API_KEY=$(grep -m1 '^MIMO_API_KEY=' ~/Reading-Partner/.env | cut -d= -f2-) \
  ~/Reading-Partner/scripts/ios-dictation/speech-run.sh speech-live
```

The key never lands on the phone's disk and is never built into the app:
`devicectl` forwards `DEVICECTL_CHILD_MIMO_API_KEY` into the launched process's
environment and Rust reads it there. The `.env` it comes from is the Linux
checkout's, so on the Mac either copy that one line over first or paste the key
into the command.

**Before the first leg that talks to the network, grant the freshly installed app
its 无线数据 permission on the phone** (设置 → 无线数据 → Reading Partner). A
mainland-China iPhone withholds it from every new install, and the cloud-signed
`.dev` build is a new install every round. Without it the request never leaves
the phone: it comes back as a transport error in about a millisecond and the
error string says nothing about why (2026-09-05, 12 of 12 sentences — see
docs/pitfall/217).

The result is `/tmp/speech-result.json` as before, with one more leg on it:
`label: "live"`, carrying the relay's own timeline in `relay` — when each
sentence's request went out, when its first audio came back, what the trim took
off, and the margin left on the player as each one was queued.

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

## Cloud signing

These scripts sign in the cloud, under the paid team, not locally under a
Personal Team. `~/.asc-env` on the Mac carries `APPLE_API_KEY`,
`APPLE_API_ISSUER`, `APPLE_API_KEY_PATH` and `APPLE_DEVELOPMENT_TEAM`; each
build script sources it and hands the three API-key variables to `xcodebuild`
through Tauri's `-allowProvisioningUpdates`. xcodebuild makes the development
certificate and the provisioning profile on demand, on the App Store Connect
key's own authority — no Apple ID needs to be signed into Xcode at all
(docs/pitfall/197).

Team `HF6369DDYP` owns both bundle ids: `com.xinyuan.readingpartner`, the
TestFlight one, and `com.xinyuan.readingpartner.dev` (resource id
`VW3G7LG4MS`), which every script here that installs onto the real device
uses. `gen/apple` regenerates whenever its cached identifier does not match.
The profile is valid about a year, not the Personal Team's seven days.

**Every script that installs onto the phone must use the `.dev` id and pass
the `.ipa` check that reads `CFBundleIdentifier` back out of it before
installing.** `tauri ios build` regenerates `gen/apple` from
`tauri.conf.json` on every run, so a `sed` rewrite of the generated project
does not hold — sed's edit is silently overwritten by the next build, and the
`.ipa` that actually gets installed still carries the shipping id. The
identifier is overridden through the CLI's `--config` merge instead (a file,
not inline JSON, so it survives the `bash -lc` inside `sudo launchctl
asuser`), and the `.ipa` check catches the case where that override didn't
take. Skipping either half installs the shipping id over the TestFlight
build on the user's phone — it has happened once already.

One step the CLI does not do: registering the device. Tauri does not pass
`-allowProvisioningDeviceRegistration`, so a Development profile for a device
the team has never seen comes back empty. Register once, by hand:

```
POST /v1/devices
{"data":{"type":"devices","attributes":{"name":"…","platform":"IOS","udid":"…"}}}
```

That write costs one of the team's 100-device-a-year iOS slots — disabling a
device does not free the slot back — so it is done once, not on every run.

The `.dev` id installs alongside the TestFlight app rather than over it, so
these scripts do not touch it. That protection only holds as long as every
install path stays on `.dev` and keeps the `.ipa` check — see the warning
above.

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
