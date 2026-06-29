/** Minimal sink the coalescer flushes batched activities into (the session-tracking repository). */
export interface ActivityCoalescerSink {
  appendActivities(
    sessionId: string,
    items: Array<{ originator?: string; description: string; createTime?: string }>,
  ): void;
}

export interface ActivityWriteCoalescerOptions {
  /** Max time a buffered activity waits before being flushed. */
  flushIntervalMs?: number;
  /** Flush immediately once this many activities are buffered. */
  maxBuffer?: number;
}

/**
 * Buffers provider streaming activities and flushes them to the sink in batched transactions.
 *
 * Provider stdout produces one activity line at a time; persisting each as its own synchronous
 * SQLite statement floods the single Node thread and the WAL when several sprints stream at once,
 * which starves unrelated work (e.g. a new planning request). Coalescing a burst into one
 * transaction keeps the same data and ordering (each line is timestamped at push time) while
 * collapsing many statements + fsyncs into one. A short flush interval bounds dashboard live-feed
 * latency; `stop()` guarantees the tail is persisted when the provider run ends.
 */
export class ActivityWriteCoalescer {
  private buffer: Array<{ originator?: string; description: string; createTime: string }> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushIntervalMs: number;
  private readonly maxBuffer: number;

  constructor(
    private readonly sink: ActivityCoalescerSink,
    private readonly sessionId: string,
    options: ActivityWriteCoalescerOptions = {},
  ) {
    this.flushIntervalMs = options.flushIntervalMs ?? 250;
    this.maxBuffer = options.maxBuffer ?? 50;
  }

  push(description: string, originator?: string): void {
    this.buffer.push({ description, originator, createTime: new Date().toISOString() });
    if (this.buffer.length >= this.maxBuffer) {
      this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
      // Never keep the process alive just to flush an activity feed.
      this.timer.unref?.();
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length === 0) {
      return;
    }
    const batch = this.buffer;
    this.buffer = [];
    try {
      this.sink.appendActivities(this.sessionId, batch);
    } catch {
      // Activity persistence is best-effort; never let it break the provider run.
    }
  }

  /** Flush any remaining buffered activities and cancel the pending timer. */
  stop(): void {
    this.flush();
  }
}
