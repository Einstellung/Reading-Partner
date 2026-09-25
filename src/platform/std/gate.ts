// A counting semaphore: at most `limit` pieces of work run at once, the rest
// wait in arrival order. A rejection gives the slot back the way a result does.
// Pure, and imports nothing.

export class Gate {
  private active = 0;
  private waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  // For tests and diagnostics: how many tasks hold a slot right now.
  get inFlight(): number {
    return this.active;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  // The slot is handed to the next waiter rather than freed and re-taken: a
  // free-then-take would let a task arriving in between slip past the limit.
  private release(): void {
    const waiter = this.waiting.shift();
    if (waiter) waiter();
    else this.active--;
  }
}
