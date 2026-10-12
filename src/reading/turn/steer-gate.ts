// A durable turn's steer and stop for a surface that holds the handle itself
// (reading/session/use-call.ts, the phone PDF lesson). The runtime's stop
// withdraws the steers already in the run's inbox; one still being submitted
// would be taken after the run ended and lost, so the stop waits for every
// steer sent before it (docs/pitfall/528). place-session.ts does the same for
// the turns it drives.

export interface SteerAndStop {
  steer(text: string, ts: number): Promise<boolean>;
  stop(): void;
}

export function gateSteers<T extends SteerAndStop>(driven: T): T {
  const going = new Set<Promise<void>>();
  return {
    ...driven,
    steer: (text: string, ts: number) => {
      const sent = driven.steer(text, ts);
      const settled: Promise<void> = sent.then(
        () => void going.delete(settled),
        () => void going.delete(settled),
      );
      going.add(settled);
      return sent;
    },
    // With no steer on its way in, the stop goes at once.
    stop: () => {
      if (going.size === 0) driven.stop();
      else void Promise.all(going).then(() => driven.stop());
    },
  };
}
