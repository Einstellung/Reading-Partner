// How far ahead of the speaker to work.
//
// One request per sentence, sentences consumed at roughly one every four
// seconds: about 13 requests a minute against a 100 RPM limit, so the limit does
// not shape this. What shapes it is RTF 0.348 — synthesis runs about three times
// faster than the audio plays — and the fact that sentence lengths vary by an
// order of magnitude. A three-character "好的。" is under a second of audio and
// costs a fixed ~700 ms of round trip regardless, so a lookahead counted in
// sentences gives a margin that swings between comfortable and negative. The
// gate here is therefore an amount of audio, not a number of sentences: keep
// `prefetch_ms` of trimmed audio queued ahead of the playhead and admit work
// while that is not met.
//
// The other thing the gate bounds is waste. Everything synthesised past the
// point where the user interrupts is thrown away, so working further ahead than
// the margin needs buys nothing and spends requests.

use std::collections::{BTreeMap, VecDeque};
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinSet;

use super::backend::{SpeechRequest, TtsBackend};
use super::error::TtsError;
use super::player::{Heard, Player, SentenceAudio};
use super::trim::{silence, SilenceTrimmer, TrimConfig, TrimReport};
use super::{synthesize_with_retry, AudioFormat};

#[derive(Debug, Clone)]
pub struct RelayConfig {
    /// Trimmed audio to keep queued ahead of the playhead.
    pub prefetch_ms: f64,
    /// Syntheses allowed in flight at once. Bounds the burst at the start of a
    /// turn, when several sentences are available and nothing is queued yet.
    pub concurrency: usize,
    /// Silence put back between two sentences, in place of what the trim took
    /// off their ends.
    pub gap_ms: f64,
    /// How long past the tail the player says it is still finishing to go on
    /// offering it the first sentence of a new turn. The wait itself is bounded
    /// by that tail and not by this: what this covers is the tail being measured
    /// before the answer travelled back, and the player taking a moment more to
    /// notice it has run out.
    pub busy_grace_ms: f64,
    pub voice: String,
    pub trim: TrimConfig,
}

impl Default for RelayConfig {
    fn default() -> Self {
        Self {
            prefetch_ms: 6000.0,
            concurrency: 2,
            gap_ms: 160.0,
            busy_grace_ms: 1000.0,
            voice: String::new(),
            trim: TrimConfig::default(),
        }
    }
}

/// Chinese is spoken at 4.41 characters a second by this voice (docs/33, 实测).
/// Used only to guess how much audio an unfinished synthesis will turn into, so
/// that admission does not overshoot while several are in flight. Never used to
/// time anything.
const CHARS_PER_SECOND: f64 = 4.41;

#[derive(Debug, Clone)]
pub enum RelayEvent {
    /// A sentence was admitted and its request went out.
    Started { id: u64, chars: usize, at_ms: f64 },
    /// The first PCM of that sentence came back.
    FirstAudio { id: u64, at_ms: f64 },
    /// The whole sentence is synthesised and trimmed.
    Ready {
        id: u64,
        at_ms: f64,
        speech_ms: f64,
        attempts: u32,
        trim: TrimReport,
    },
    /// It went to the player. `queued_ahead_ms` is the margin at that moment:
    /// how long the speaker could go on if nothing else ever arrived.
    Queued {
        id: u64,
        at_ms: f64,
        queued_ahead_ms: f64,
    },
    /// The sentence never happened. Playback carries on with the next one.
    Failed { id: u64, at_ms: f64, error: String },
    /// The player would not take the sentence yet: it is still finishing the
    /// turn before this one, with `tail_ms` of it left. Nothing is lost — the
    /// same sentence is offered again — but the turn starts late, and the
    /// reason it is late is that whatever opened this turn did not silence the
    /// one before it.
    Waiting { id: u64, at_ms: f64, tail_ms: f64 },
    /// The player refused the sentence because this turn is no longer the one
    /// it is speaking. The turn is over: what is still in flight is cancelled
    /// and nothing behind this sentence is synthesised or sent.
    Abandoned { id: u64, at_ms: f64 },
    /// Every sentence that was pushed has been queued with the player, and the
    /// loop has ended. Nothing follows it.
    ///
    /// Not the voice falling silent: what was queued at that moment is still
    /// playing. Nothing in Rust knows when the last buffer runs out — the
    /// player node does, and on the phone Swift is what says so, in the
    /// `speech` event's `speaking: 0`. Do not wait on this to decide a turn has
    /// been heard.
    Drained { at_ms: f64 },
}

enum Command {
    Push(String),
    Close,
    Stop(oneshot::Sender<Result<Heard, TtsError>>),
}

/// Drives synthesis for one turn: sentences in, audio out, in order.
pub struct SpeechRelay {
    commands: mpsc::UnboundedSender<Command>,
}

impl SpeechRelay {
    /// Starts the loop. `events` receives the timeline; dropping the receiver is
    /// allowed and only loses the record.
    pub fn start(
        backend: Arc<dyn TtsBackend>,
        player: Arc<dyn Player>,
        config: RelayConfig,
        events: mpsc::UnboundedSender<RelayEvent>,
    ) -> Self {
        let (commands, rx) = mpsc::unbounded_channel();
        tokio::spawn(run(backend, player, config, events, rx));
        Self { commands }
    }

    /// Hand over the next sentence. Returns false once the relay has stopped.
    pub fn push(&self, text: impl Into<String>) -> bool {
        self.commands.send(Command::Push(text.into())).is_ok()
    }

    /// No more sentences are coming in this turn. What was already pushed is
    /// still synthesised and still spoken; the loop ends by itself once the
    /// last of it has been handed to the player, and `Drained` is the last
    /// thing it sends. Dropping this handle says the same thing.
    pub fn close(&self) -> bool {
        self.commands.send(Command::Close).is_ok()
    }

    /// Barge-in. Cancels what is in flight, drops what is queued, stops the
    /// player and answers with where the user was interrupted.
    ///
    /// `Cancelled` means there was no loop left to stop — the turn was closed
    /// and every sentence of it has already been handed over. The player is
    /// then the caller's to stop; the relay no longer holds anything.
    ///
    /// Any other error is the player's own: the relay reached it and it would
    /// not stop. That is the failure the caller has to see rather than a
    /// position made up on its behalf — the audio is still playing.
    pub async fn stop(&self) -> Result<Heard, TtsError> {
        let (tx, rx) = oneshot::channel();
        if self.commands.send(Command::Stop(tx)).is_err() {
            return Err(TtsError::Cancelled);
        }
        match rx.await {
            Ok(answer) => answer,
            Err(_) => Err(TtsError::Cancelled),
        }
    }
}

struct Pending {
    id: u64,
    text: String,
}

struct Done {
    id: u64,
    chars: usize,
    result: Result<(Vec<u8>, TrimReport, u32), TtsError>,
}

async fn run(
    backend: Arc<dyn TtsBackend>,
    player: Arc<dyn Player>,
    config: RelayConfig,
    events: mpsc::UnboundedSender<RelayEvent>,
    mut commands: mpsc::UnboundedReceiver<Command>,
) {
    let started = Instant::now();
    let format = backend.format();
    let mut pending: VecDeque<Pending> = VecDeque::new();
    let mut inflight: JoinSet<Done> = JoinSet::new();
    let mut inflight_chars: BTreeMap<u64, usize> = BTreeMap::new();
    let mut ready: BTreeMap<u64, (Vec<u8>, usize)> = BTreeMap::new();
    let mut failed: BTreeMap<u64, ()> = BTreeMap::new();
    let mut next_id: u64 = 0;
    let mut next_to_queue: u64 = 0;
    let mut closed = false;
    // False once the handle is gone. The turn still finishes what it holds:
    // dropping a relay is the caller letting go, not the caller cancelling.
    let mut listening = true;
    // The sentence the player would not take yet because it is still finishing
    // an earlier turn, held for the next attempt. It sits here rather than back
    // in `ready` because it is already past `next_to_queue`: the id left the
    // queue when it was first offered, and everything behind it waits for it.
    let mut waiting: Option<(u64, Vec<u8>, usize)> = None;
    // When to stop offering it. Set from the tail the player reported, so the
    // wait is bounded by what the player says it is still holding rather than by
    // a number chosen here.
    let mut wait_until: Option<Instant> = None;
    // True once the player has taken a sentence of this turn. From then on it is
    // this turn the player is speaking, so nothing later can come back `Busy`,
    // and nothing is kept for a second attempt.
    let mut accepted = false;
    // True once a sentence went over with `last` on it. The flag rides on the
    // audio, so a turn whose final sentences all failed never sends one, and the
    // player has to be told some other way before the loop ends.
    let mut told_last = false;

    let mut tick = tokio::time::interval(std::time::Duration::from_millis(100));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        // Anything finished and next in line goes to the player before more work
        // is admitted: the margin the gate reads has to be up to date.
        while let Some((id, pcm, chars)) = waiting.take().or_else(|| {
            ready
                .remove(&next_to_queue)
                .map(|(pcm, chars)| (next_to_queue, pcm, chars))
        }) {
            if id == next_to_queue {
                next_to_queue += 1;
            }
            // Nothing else can produce a sentence and no more are coming, so
            // this is the turn's last. The player needs it to tell a turn that
            // ended from a turn that starved.
            let last = closed && pending.is_empty() && inflight.is_empty() && ready.is_empty();
            // Only a sentence offered before the player has taken any of this
            // turn's can come back `Busy`, so that is exactly how long a copy is
            // worth keeping. Past that point the audio is handed over once.
            let second_attempt = (!accepted).then(|| pcm.clone());
            let state = player
                .enqueue(SentenceAudio {
                    id,
                    format,
                    pcm,
                    chars,
                    last,
                })
                .await;
            match state {
                Ok(state) => {
                    accepted = true;
                    told_last |= last;
                    wait_until = None;
                    let _ = events.send(RelayEvent::Queued {
                        id,
                        at_ms: elapsed_ms(started),
                        queued_ahead_ms: state.queued_ahead_ms,
                    });
                }
                // Not this sentence being refused: the player carries one
                // utterance for its whole life and answers `Cancelled` only
                // when that turn is behind the one being spoken (speaker.rs),
                // so everything behind this sentence would be refused too.
                // Going on would spend the vendor's quota on audio nobody can
                // hear.
                Err(TtsError::Cancelled) => {
                    inflight.shutdown().await;
                    let _ = events.send(RelayEvent::Abandoned {
                        id,
                        at_ms: elapsed_ms(started),
                    });
                    return;
                }
                // The other way round: this turn is ahead of the one being
                // spoken, and the player is only finishing that one's tail. The
                // sentence is offered again on the next tick, for as long as the
                // tail the player reported says it needs.
                Err(TtsError::Busy { tail_ms }) => {
                    let now = Instant::now();
                    let spent = wait_until.is_some_and(|until| now >= until);
                    match second_attempt {
                        Some(pcm) if !spent => {
                            let horizon = now
                                + std::time::Duration::from_secs_f64(
                                    (tail_ms.max(0.0) + config.busy_grace_ms.max(0.0)) / 1000.0,
                                );
                            wait_until =
                                Some(wait_until.map_or(horizon, |until| until.max(horizon)));
                            let _ = events.send(RelayEvent::Waiting {
                                id,
                                at_ms: elapsed_ms(started),
                                tail_ms,
                            });
                            waiting = Some((id, pcm, chars));
                            break;
                        }
                        // Either the tail has had as long as it said it needed
                        // and something other than playback is keeping the
                        // player, or the player took a sentence of this turn and
                        // is somehow busy with an earlier one anyway. Both mean
                        // this turn is not going to be spoken.
                        _ => {
                            inflight.shutdown().await;
                            let _ = events.send(RelayEvent::Abandoned {
                                id,
                                at_ms: elapsed_ms(started),
                            });
                            return;
                        }
                    }
                }
                Err(e) => {
                    let _ = events.send(RelayEvent::Failed {
                        id,
                        at_ms: elapsed_ms(started),
                        error: e.to_string(),
                    });
                }
            }
        }
        // A sentence nobody will ever hear must not hold up the ones behind it.
        while failed.remove(&next_to_queue).is_some() {
            next_to_queue += 1;
        }

        // Admission.
        while !pending.is_empty() && inflight.len() < config.concurrency {
            let queued_ahead = player
                .state()
                .await
                .map(|s| s.queued_ahead_ms)
                .unwrap_or(0.0);
            let coming = ready
                .values()
                .map(|(pcm, _)| format.duration_ms(pcm.len()))
                .sum::<f64>()
                + inflight_chars
                    .values()
                    .map(|c| *c as f64 / CHARS_PER_SECOND * 1000.0)
                    .sum::<f64>();
            if queued_ahead + coming >= config.prefetch_ms {
                break;
            }
            let job = pending.pop_front().expect("checked above");
            let chars = job.text.chars().count();
            inflight_chars.insert(job.id, chars);
            let _ = events.send(RelayEvent::Started {
                id: job.id,
                chars,
                at_ms: elapsed_ms(started),
            });
            let backend = backend.clone();
            let events_for_task = events.clone();
            let voice = config.voice.clone();
            let trim = config.trim;
            let gap_ms = config.gap_ms;
            inflight.spawn(async move {
                let result = synthesize_one(
                    backend,
                    SpeechRequest {
                        text: job.text,
                        voice,
                    },
                    format,
                    trim,
                    gap_ms,
                    job.id,
                    started,
                    events_for_task,
                )
                .await;
                Done {
                    id: job.id,
                    chars,
                    result,
                }
            });
        }

        // The turn is through. Nothing can produce another sentence, and the
        // last one went to the player in the drain above — the three emptied
        // together is exactly what says every id was handed over. Returning
        // here rather than idling on the tick is what makes a closed turn cost
        // nothing between turns; the caller is left holding a handle whose
        // `push` answers false and whose `stop` answers `Cancelled`.
        if closed
            && pending.is_empty()
            && inflight.is_empty()
            && ready.is_empty()
            && waiting.is_none()
        {
            // The turn ended on a sentence the player never got: the last one
            // failed, or was refused. Nothing carried the flag, so the player is
            // told separately — otherwise its queue running out reads as a turn
            // that starved, and a turn that ended cannot be told from one that
            // did (tts/player.rs). Nothing was accepted at all means the player
            // never started this turn and has nothing to end.
            if accepted && !told_last {
                let _ = player.finish().await;
            }
            let _ = events.send(RelayEvent::Drained {
                at_ms: elapsed_ms(started),
            });
            return;
        }

        tokio::select! {
            command = commands.recv(), if listening => match command {
                Some(Command::Push(text)) => {
                    pending.push_back(Pending { id: next_id, text });
                    next_id += 1;
                }
                Some(Command::Close) => closed = true,
                Some(Command::Stop(reply)) => {
                    inflight.shutdown().await;
                    // Whatever the player says, including that it would not
                    // stop: the caller falls back to stopping it itself on an
                    // error, and cannot if this answers with a position.
                    let _ = reply.send(player.stop().await);
                    return;
                }
                // The handle was dropped. Finishing is the only safe reading:
                // returning here would bin what is queued and in flight, and
                // the player would never be told which sentence was the last.
                None => {
                    closed = true;
                    listening = false;
                }
            },
            Some(done) = inflight.join_next(), if !inflight.is_empty() => {
                let Ok(done) = done else { continue };
                inflight_chars.remove(&done.id);
                match done.result {
                    Ok((pcm, trim, attempts)) => {
                        let _ = events.send(RelayEvent::Ready {
                            id: done.id,
                            at_ms: elapsed_ms(started),
                            speech_ms: format.duration_ms(pcm.len()),
                            attempts,
                            trim,
                        });
                        ready.insert(done.id, (pcm, done.chars));
                    }
                    Err(e) => {
                        let _ = events.send(RelayEvent::Failed {
                            id: done.id,
                            at_ms: elapsed_ms(started),
                            error: e.to_string(),
                        });
                        failed.insert(done.id, ());
                    }
                }
            },
            _ = tick.tick() => {}
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn synthesize_one(
    backend: Arc<dyn TtsBackend>,
    request: SpeechRequest,
    format: AudioFormat,
    trim: TrimConfig,
    gap_ms: f64,
    id: u64,
    started: Instant,
    events: mpsc::UnboundedSender<RelayEvent>,
) -> Result<(Vec<u8>, TrimReport, u32), TtsError> {
    // Bounded: the trimmer drains it as fast as chunks arrive, and a bound is
    // what makes a stopped reader push back on a running synthesis.
    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(8);

    // Trimming runs beside the synthesis rather than after it. The tail cannot
    // be decided until the stream ends, but the head can, and everything past
    // the holdback window can go out while the rest is still arriving.
    let collector = tokio::spawn(async move {
        let mut trimmer = SilenceTrimmer::new(format, trim);
        let mut out = Vec::new();
        let mut first = true;
        while let Some(chunk) = rx.recv().await {
            if first {
                first = false;
                let _ = events.send(RelayEvent::FirstAudio {
                    id,
                    at_ms: elapsed_ms(started),
                });
            }
            out.extend(trimmer.push(&chunk));
        }
        out.extend(trimmer.finish());
        (out, trimmer.report())
    });

    // `tx` goes in by value: dropping it on the way out is what ends the loop
    // above, on the error path as much as on the good one.
    let attempts = synthesize_with_retry(backend.as_ref(), &request, tx).await;
    let (mut out, report) = collector.await.map_err(|e| TtsError::Protocol(e.to_string()))?;
    let attempts = attempts?;

    // The pause between sentences goes on the end of each one rather than in
    // front of the next, so that the first sentence of a turn starts speaking
    // the moment it is queued.
    out.extend(silence(format, gap_ms));
    Ok((out, report, attempts))
}

fn elapsed_ms(from: Instant) -> f64 {
    from.elapsed().as_secs_f64() * 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tts::{PlaybackState, VirtualPlayer};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;
    use std::time::Duration;

    /// A sentence this vendor refuses. Never retried (error.rs), so it is one
    /// sentence lost out of the turn.
    const REFUSED: &str = "\u{2717}";

    /// A vendor that answers everything but `REFUSED`, with a fixed length of
    /// loud tone so that the trim has something to keep.
    struct Tone {
        ms: f64,
        /// Sentences it was actually asked for. Read by the test that asserts
        /// an abandoned turn stops spending.
        started: Arc<AtomicUsize>,
    }

    impl Tone {
        fn new(ms: f64) -> Self {
            Self {
                ms,
                started: Arc::new(AtomicUsize::new(0)),
            }
        }
    }

    #[async_trait::async_trait]
    impl TtsBackend for Tone {
        fn id(&self) -> &'static str {
            "tone"
        }
        fn model(&self) -> &str {
            "tone"
        }
        fn format(&self) -> AudioFormat {
            AudioFormat::PCM16_24K_MONO
        }
        fn default_voice(&self) -> &str {
            "tone"
        }
        async fn synthesize(
            &self,
            request: &SpeechRequest,
            out: mpsc::Sender<Vec<u8>>,
        ) -> Result<(), TtsError> {
            self.started.fetch_add(1, Ordering::SeqCst);
            if request.text == REFUSED {
                return Err(TtsError::Moderated {
                    code: None,
                    message: "not this one".to_string(),
                });
            }
            let format = AudioFormat::PCM16_24K_MONO;
            let samples = format.bytes_for_ms(self.ms) / 2;
            let pcm: Vec<u8> = (0..samples)
                .flat_map(|i| (if i % 2 == 0 { 8000i16 } else { -8000 }).to_le_bytes())
                .collect();
            out.send(pcm).await.map_err(|_| TtsError::Cancelled)?;
            Ok(())
        }
    }

    /// A player that writes down what it was handed and nothing else. The
    /// margin it answers with is zero, so admission never waits and the order
    /// below is the relay's own.
    #[derive(Default)]
    struct Recorder {
        queued: Mutex<Vec<(u64, bool)>>,
        /// From this sentence on, the turn is refused the way a phone refuses
        /// one whose utterance is behind the turn it is speaking.
        refuse_from: Option<u64>,
        /// Offers to bounce before taking anything, the way a phone still
        /// finishing the turn before this one does. `usize::MAX` is a tail that
        /// never ends.
        busy_offers: AtomicUsize,
        /// How many were bounced that way.
        bounced: AtomicUsize,
        /// Times the turn was said to be over with no audio to carry it.
        finished: AtomicUsize,
        /// A player that will not shut up.
        refuse_stop: bool,
    }

    impl Recorder {
        fn bounced(&self) -> usize {
            self.bounced.load(Ordering::SeqCst)
        }

        fn finished(&self) -> usize {
            self.finished.load(Ordering::SeqCst)
        }
    }

    #[async_trait::async_trait]
    impl Player for Recorder {
        async fn enqueue(&self, sentence: SentenceAudio) -> Result<PlaybackState, TtsError> {
            // Before the record: an offer bounced for being early was never
            // taken, and it is offered again.
            if self
                .busy_offers
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |left| left.checked_sub(1))
                .is_ok()
            {
                self.bounced.fetch_add(1, Ordering::SeqCst);
                return Err(TtsError::Busy { tail_ms: 30.0 });
            }
            self.queued
                .lock()
                .unwrap()
                .push((sentence.id, sentence.last));
            if self.refuse_from.is_some_and(|from| sentence.id >= from) {
                return Err(TtsError::Cancelled);
            }
            Ok(PlaybackState {
                queued_ahead_ms: 0.0,
                playing: true,
            })
        }

        async fn state(&self) -> Result<PlaybackState, TtsError> {
            Ok(PlaybackState {
                queued_ahead_ms: 0.0,
                playing: true,
            })
        }

        async fn stop(&self) -> Result<Heard, TtsError> {
            if self.refuse_stop {
                return Err(TtsError::Player("the node would not stop".to_string()));
            }
            Ok(Heard {
                sentence: 0,
                position_ms: 0.0,
                duration_ms: 0.0,
            })
        }

        async fn finish(&self) -> Result<(), TtsError> {
            self.finished.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    #[tokio::test]
    async fn sentences_are_queued_in_order_and_only_the_last_one_says_so() {
        let player = Arc::new(Recorder::default());
        let (events, mut incoming) = mpsc::unbounded_channel();
        let relay = SpeechRelay::start(
            Arc::new(Tone::new(200.0)),
            player.clone(),
            RelayConfig::default(),
            events,
        );
        relay.push("一");
        relay.push("二");
        relay.push("三");
        relay.close();

        while let Some(event) = incoming.recv().await {
            if matches!(event, RelayEvent::Drained { .. }) {
                break;
            }
        }

        let queued = player.queued.lock().unwrap().clone();
        assert_eq!(queued, vec![(0, false), (1, false), (2, true)]);
        // The flag rode on the audio, so nothing was said separately.
        assert_eq!(player.finished(), 0);
    }

    /// Every event of a turn, up to and including the loop's end. The channel
    /// runs dry only when the loop drops the sender it holds, so this returning
    /// is the loop having ended rather than a guess that it has.
    /// The bound turns a loop that went back to idling — which is the thing
    /// these tests are here to catch — into a failure rather than a hang.
    async fn timeline(incoming: &mut mpsc::UnboundedReceiver<RelayEvent>) -> Vec<RelayEvent> {
        let mut seen = Vec::new();
        let drained = tokio::time::timeout(Duration::from_secs(5), async {
            while let Some(event) = incoming.recv().await {
                seen.push(event);
            }
        })
        .await;
        assert!(drained.is_ok(), "the loop never ended: {seen:?}");
        seen
    }

    #[tokio::test]
    async fn a_closed_turn_ends_its_own_loop_once_the_last_sentence_is_queued() {
        let player = Arc::new(Recorder::default());
        let (events, mut incoming) = mpsc::unbounded_channel();
        let relay = SpeechRelay::start(
            Arc::new(Tone::new(200.0)),
            player.clone(),
            RelayConfig::default(),
            events,
        );
        relay.push("一");
        relay.push("二");
        relay.close();

        let seen = timeline(&mut incoming).await;
        assert!(
            matches!(seen.last(), Some(RelayEvent::Drained { .. })),
            "{seen:?}"
        );
        assert_eq!(*player.queued.lock().unwrap(), vec![(0, false), (1, true)]);
        // Nothing is left ticking behind it, and the handle says so.
        assert!(!relay.push("三"));
    }

    #[tokio::test]
    async fn dropping_the_handle_finishes_the_turn_instead_of_binning_it() {
        let player = Arc::new(Recorder::default());
        let (events, mut incoming) = mpsc::unbounded_channel();
        let relay = SpeechRelay::start(
            Arc::new(Tone::new(200.0)),
            player.clone(),
            RelayConfig::default(),
            events,
        );
        relay.push("一");
        relay.push("二");
        relay.push("三");
        drop(relay);

        let seen = timeline(&mut incoming).await;
        assert!(
            matches!(seen.last(), Some(RelayEvent::Drained { .. })),
            "{seen:?}"
        );
        // All three, and the last one told it was the last: a player that is
        // never told cannot tell a turn that ended from a turn that starved.
        assert_eq!(
            *player.queued.lock().unwrap(),
            vec![(0, false), (1, false), (2, true)]
        );
    }

    #[tokio::test]
    async fn a_player_that_refuses_the_turn_ends_it_rather_than_the_sentence() {
        let player = Arc::new(Recorder {
            refuse_from: Some(1),
            ..Default::default()
        });
        let tone = Arc::new(Tone::new(200.0));
        let started = tone.started.clone();
        let (events, mut incoming) = mpsc::unbounded_channel();
        let relay = SpeechRelay::start(tone, player.clone(), RelayConfig::default(), events);
        for text in ["一", "二", "三", "四"] {
            relay.push(text);
        }
        relay.close();

        let seen = timeline(&mut incoming).await;
        assert!(
            matches!(seen.last(), Some(RelayEvent::Abandoned { id: 1, .. })),
            "{seen:?}"
        );
        // Nothing behind the refused sentence was handed over.
        assert_eq!(*player.queued.lock().unwrap(), vec![(0, false), (1, false)]);
        // And the turn stopped spending. What was already admitted when the
        // refusal came back was paid for whatever happens next — a request in
        // flight has left — so the guarantee is about admission: the sentences
        // still queued behind the gate never went out, and none goes out after.
        let paid = started.load(Ordering::SeqCst);
        assert!(paid < 4, "{paid} of 4 sentences reached the vendor");
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(started.load(Ordering::SeqCst), paid);
    }

    /// A player still finishing the turn before this one is not refusing this
    /// one. Every sentence still gets there, in order, and the last one still
    /// says it is the last — the turn only starts late.
    #[tokio::test]
    async fn a_player_finishing_an_earlier_turn_is_waited_out() {
        let player = Arc::new(Recorder {
            busy_offers: AtomicUsize::new(2),
            ..Default::default()
        });
        let (events, mut incoming) = mpsc::unbounded_channel();
        let relay = SpeechRelay::start(
            Arc::new(Tone::new(200.0)),
            player.clone(),
            RelayConfig::default(),
            events,
        );
        relay.push("一");
        relay.push("二");
        relay.close();

        let seen = timeline(&mut incoming).await;
        assert!(
            matches!(seen.last(), Some(RelayEvent::Drained { .. })),
            "{seen:?}"
        );
        // Both offers were of the first sentence, and it is the first sentence
        // that was queued: a turn that waits does not skip ahead.
        assert_eq!(player.bounced(), 2);
        assert!(
            seen.iter()
                .any(|e| matches!(e, RelayEvent::Waiting { id: 0, .. })),
            "{seen:?}"
        );
        assert_eq!(*player.queued.lock().unwrap(), vec![(0, false), (1, true)]);
    }

    /// The wait is bounded. A player that says it is busy for longer than the
    /// tail it reported is not finishing anything, and the turn ends rather
    /// than the loop going round for ever.
    #[tokio::test]
    async fn a_player_that_is_busy_for_ever_ends_the_turn() {
        let player = Arc::new(Recorder {
            busy_offers: AtomicUsize::new(usize::MAX),
            ..Default::default()
        });
        let (events, mut incoming) = mpsc::unbounded_channel();
        let relay = SpeechRelay::start(
            Arc::new(Tone::new(200.0)),
            player.clone(),
            RelayConfig {
                busy_grace_ms: 30.0,
                ..RelayConfig::default()
            },
            events,
        );
        relay.push("一");
        relay.push("二");
        relay.close();

        let seen = timeline(&mut incoming).await;
        assert!(
            matches!(seen.last(), Some(RelayEvent::Abandoned { id: 0, .. })),
            "{seen:?}"
        );
        assert!(player.queued.lock().unwrap().is_empty());
        // It was offered more than once: the give-up is a deadline passing, not
        // the first refusal.
        assert!(player.bounced() > 1, "{} offers", player.bounced());
    }

    /// The turn's last sentence never came back, so the flag that says a turn
    /// ended had nothing to ride on. The player is told anyway: without it, a
    /// turn that ended cannot be told from one that ran dry (tts/player.rs).
    #[tokio::test]
    async fn a_turn_whose_last_sentence_fails_still_says_it_is_over() {
        let player = Arc::new(Recorder::default());
        let (events, mut incoming) = mpsc::unbounded_channel();
        let relay = SpeechRelay::start(
            Arc::new(Tone::new(200.0)),
            player.clone(),
            RelayConfig::default(),
            events,
        );
        relay.push("一");
        relay.push(REFUSED);
        relay.close();

        let seen = timeline(&mut incoming).await;
        assert!(
            matches!(seen.last(), Some(RelayEvent::Drained { .. })),
            "{seen:?}"
        );
        assert!(
            seen.iter()
                .any(|e| matches!(e, RelayEvent::Failed { id: 1, .. })),
            "{seen:?}"
        );
        // Only the first sentence was ever queued, and it went over before the
        // second failed, so nothing carried the flag.
        assert_eq!(*player.queued.lock().unwrap(), vec![(0, false)]);
        assert_eq!(player.finished(), 1);
    }

    /// A turn that was never heard has nothing to end. The player never started
    /// on it, and telling it the turn is over would be about somebody else's.
    #[tokio::test]
    async fn a_turn_that_reached_the_player_with_nothing_says_nothing() {
        let player = Arc::new(Recorder::default());
        let (events, mut incoming) = mpsc::unbounded_channel();
        let relay = SpeechRelay::start(
            Arc::new(Tone::new(200.0)),
            player.clone(),
            RelayConfig::default(),
            events,
        );
        relay.push(REFUSED);
        relay.close();

        let seen = timeline(&mut incoming).await;
        assert!(
            matches!(seen.last(), Some(RelayEvent::Drained { .. })),
            "{seen:?}"
        );
        assert!(player.queued.lock().unwrap().is_empty());
        assert_eq!(player.finished(), 0);
    }

    /// A player that will not stop is the caller's problem, and the caller can
    /// only have it if the relay hands it over: a position invented here would
    /// read as a turn that had been silenced.
    #[tokio::test]
    async fn a_player_that_will_not_stop_is_reported_rather_than_covered_for() {
        let player = Arc::new(Recorder {
            refuse_stop: true,
            ..Default::default()
        });
        let (events, _incoming) = mpsc::unbounded_channel();
        let relay = SpeechRelay::start(
            Arc::new(Tone::new(200.0)),
            player.clone(),
            RelayConfig::default(),
            events,
        );
        relay.push("一");

        let stopped = relay.stop().await;
        assert!(matches!(stopped, Err(TtsError::Player(_))), "{stopped:?}");
    }

    #[tokio::test]
    async fn drained_is_every_sentence_queued_and_not_the_voice_falling_silent() {
        let player = Arc::new(VirtualPlayer::new());
        let (events, mut incoming) = mpsc::unbounded_channel();
        let relay = SpeechRelay::start(
            Arc::new(Tone::new(2000.0)),
            player.clone(),
            RelayConfig::default(),
            events,
        );
        relay.push("一");
        relay.close();

        let seen = timeline(&mut incoming).await;
        assert!(
            matches!(seen.last(), Some(RelayEvent::Drained { .. })),
            "{seen:?}"
        );
        // Two seconds of audio went to the player a moment ago and is still
        // playing. Whoever wants the end of it has to ask the player.
        let left = player.state().await.unwrap().queued_ahead_ms;
        assert!(left > 1500.0, "{left} ms of audio left");
    }
}
