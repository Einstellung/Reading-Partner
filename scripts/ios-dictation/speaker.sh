#!/bin/bash
# Watch the device console and talk to the phone.
#
# The smoke build on the phone cannot reach this machine, so the cue is what the
# plugin logs at the top of every hold — the locale, and how many hot words it
# was given. The hot-word count carries the phrase length, because a six-second
# sentence played into a two-second hold measures nothing:
#
#   locale=en-US contextualStrings=1  -> one English sentence
#   locale=en-US contextualStrings=3  -> the long English passage
#   locale=zh-CN contextualStrings=2  -> one Chinese sentence
#   locale=zh-CN contextualStrings=4  -> the long Chinese passage
#   locale=auto  contextualStrings=1  -> one English sentence (the composer's
#                                        bar, which passes a glossary and no
#                                        locale)
#   anything else                     -> stay quiet
#
# Two things had to be measured to make this work at all. The microphone does
# not open until roughly 700 ms after the command starts, so the phrase waits
# that out or its first words are spoken into a closed session. And `say` runs
# detached, so without killing the previous one the tail of one scenario's
# speech lands inside the next scenario's hold.
export PATH="/opt/homebrew/bin:/usr/bin:/bin"
LOG=${1:-/tmp/rp-dict.log}

EN_SHORT="Attention is all you need."
EN_LONG="Attention is all you need. The transformer replaced recurrence with self attention, and it reads the whole sentence at once."
ZH_SHORT="注意力机制取代了循环结构。"
ZH_LONG="第一点，注意力机制取代了循环结构。第二点，机器之心报道了这项工作。第三点，这个模型一次读完整句话。"

# Named rather than picked off the list: the first en_US entry `say -v '?'`
# reports is a novelty voice ("Albert"), and half the zh_CN names carry
# parenthesised locale suffixes that do not survive a shell word.
EN_VOICE=Samantha
ZH_VOICE=Tingting

# The phone hears the room, so the room has to be loud enough. Measured: at 12
# the recognizer returns nothing at all from across the desk.
osascript -e "set volume output volume 85" 2>/dev/null || true
echo "voices: en=$EN_VOICE zh=$ZH_VOICE; output volume $(osascript -e 'output volume of (get volume settings)')"

speak() {
  local voice="$1" text="$2"
  pkill -x say 2>/dev/null || true
  # Set the volume every time, not once at startup. Measured: it kept coming
  # back at 7 out of 100 between scenarios, and at that level the recognizer
  # returns nothing at all while the levels sit at the -80 dB noise floor. One
  # quiet scenario is indistinguishable from a broken one in the data.
  ( osascript -e "set volume output volume 85" >/dev/null 2>&1
    sleep 0.9
    say -v "$voice" -r 175 "$text" ) &
}

tail -n 0 -F "$LOG" 2>/dev/null | while IFS= read -r line; do
  case "$line" in
    *"RP-DICT start locale=en-US contextualStrings=3"*)
      echo "$(date +%H:%M:%S) EN long"; speak "$EN_VOICE" "$EN_LONG" ;;
    *"RP-DICT start locale=en-US"*)
      echo "$(date +%H:%M:%S) EN short"; speak "$EN_VOICE" "$EN_SHORT" ;;
    *"RP-DICT start locale=zh-CN contextualStrings=4"*)
      echo "$(date +%H:%M:%S) ZH long"; speak "$ZH_VOICE" "$ZH_LONG" ;;
    *"RP-DICT start locale=zh-CN"*)
      echo "$(date +%H:%M:%S) ZH short"; speak "$ZH_VOICE" "$ZH_SHORT" ;;
    *"RP-DICT start locale=auto contextualStrings=1"*)
      echo "$(date +%H:%M:%S) EN short (bar)"; speak "$EN_VOICE" "$EN_SHORT" ;;
  esac
done
