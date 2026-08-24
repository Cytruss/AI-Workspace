interface QueuedOperation<T> {
  signal: AbortSignal;
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  abort: () => void;
  cancelled: boolean;
}

function abortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException("Operation aborted", "AbortError");
}

export class ConcurrencyGate {
  private running = 0;
  private readonly queue: QueuedOperation<unknown>[] = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error("Concurrency limit must be a positive integer");
  }

  run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    if (signal.aborted) return Promise.reject(abortReason(signal));
    return new Promise<T>((resolve, reject) => {
      const queued: QueuedOperation<T> = {
        signal,
        operation,
        resolve,
        reject,
        cancelled: false,
        abort: () => {
          queued.cancelled = true;
          const index = this.queue.indexOf(queued as QueuedOperation<unknown>);
          if (index !== -1) this.queue.splice(index, 1);
          reject(abortReason(signal));
        },
      };
      signal.addEventListener("abort", queued.abort, { once: true });
      this.queue.push(queued as QueuedOperation<unknown>);
      this.drain();
    });
  }

  private drain(): void {
    while (this.running < this.limit && this.queue.length > 0) {
      const queued = this.queue.shift();
      if (queued === undefined || queued.cancelled) continue;
      if (queued.signal.aborted) {
        queued.abort();
        continue;
      }
      this.running += 1;
      queued.signal.removeEventListener("abort", queued.abort);
      void Promise.resolve()
        .then(() => {
          if (queued.signal.aborted) throw abortReason(queued.signal);
          return queued.operation();
        })
        .then(queued.resolve, queued.reject)
        .finally(() => {
          this.running -= 1;
          this.drain();
        });
    }
  }
}
