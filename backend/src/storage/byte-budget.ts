/** Thrown by `ByteBudget.acquire` when the bytes did not free up in time. */
export class ByteBudgetTimeoutError extends Error {
  constructor(
    readonly bytes: number,
    readonly timeoutMs: number,
  ) {
    super(`No room for ${bytes} bytes within ${timeoutMs}ms`);
    this.name = 'ByteBudgetTimeoutError';
  }
}

interface Waiter {
  bytes: number;
  grant: (release: () => void) => void;
}

/**
 * A process-wide cap on bytes held in memory at once. Callers `acquire()`
 * before buffering and call the returned release once done (in a `finally`).
 * Requests are granted in arrival order, so a large one is not starved by a
 * stream of small ones. A request bigger than the whole budget is cut down to
 * the budget: it waits until nothing else is held, then runs alone.
 */
export class ByteBudget {
  private held = 0;
  private readonly queue: Waiter[] = [];

  constructor(readonly total: number) {
    if (!Number.isFinite(total) || total <= 0) {
      throw new Error(`ByteBudget needs a positive size, got ${total}`);
    }
  }

  /** Bytes currently held. */
  get inUse(): number {
    return this.held;
  }

  /**
   * Resolves with a release function once `bytes` fit, or rejects with
   * ByteBudgetTimeoutError after `timeoutMs`.
   */
  acquire(bytes: number, timeoutMs: number): Promise<() => void> {
    const want = Math.min(Math.max(0, Math.ceil(bytes)), this.total);
    if (this.queue.length === 0 && this.held + want <= this.total) {
      return Promise.resolve(this.take(want));
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        bytes: want,
        grant: (release) => {
          clearTimeout(timer);
          resolve(release);
        },
      };
      const timer = setTimeout(() => {
        const at = this.queue.indexOf(waiter);
        if (at >= 0) this.queue.splice(at, 1);
        reject(new ByteBudgetTimeoutError(want, timeoutMs));
        // A big waiter at the head may have been blocking smaller ones.
        this.drain();
      }, timeoutMs);
      this.queue.push(waiter);
    });
  }

  private take(bytes: number): () => void {
    this.held += bytes;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.held -= bytes;
      this.drain();
    };
  }

  private drain(): void {
    while (this.queue.length > 0 && this.held + this.queue[0].bytes <= this.total) {
      const next = this.queue.shift()!;
      next.grant(this.take(next.bytes));
    }
  }
}

/** Default total for `UPLOAD_VERIFY_MEMORY_MB` when it is unset or invalid. */
export const DEFAULT_UPLOAD_VERIFY_MEMORY_MB = 256;

/** Bytes upload verification may hold at once, from `UPLOAD_VERIFY_MEMORY_MB`. */
export function uploadVerifyBudgetBytes(
  raw = process.env.UPLOAD_VERIFY_MEMORY_MB,
): number {
  const mb = Number(raw);
  return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_UPLOAD_VERIFY_MEMORY_MB) * 1024 * 1024;
}
