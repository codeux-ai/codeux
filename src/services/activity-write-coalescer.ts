/** Minimal sink the coalescer flushes batched activities into (the session-tracking repository). */
export interface ActivityCoalescerSink {
  appendActivities(
    sessionId: string,
    items: Array<{ originator?: string; description: string; createTime?: string }>,
  ): void;
}

export interface ActivityCoalescerLogger {
  warn(message: string, metadata?: Record<string, unknown>): void;
}

export interface ActivityWriteCoalescerOptions {
  /** Max time a buffered activity waits before being flushed. */
  flushIntervalMs?: number;
  /** Flush immediately once this many activities are buffered. */
  maxBuffer?: number;
  /** Maximum UTF-16 characters retained in one compacted activity row. */
  maxChunkChars?: number;
  /** Optional structured logger used to surface best-effort persistence failures. */
  logger?: ActivityCoalescerLogger;
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
  private readonly maxChunkChars: number;
  private readonly logger: ActivityCoalescerLogger | null;

  constructor(
    private readonly sink: ActivityCoalescerSink,
    private readonly sessionId: string,
    options: ActivityWriteCoalescerOptions = {},
  ) {
    this.flushIntervalMs = Math.max(0, options.flushIntervalMs ?? 250);
    this.maxBuffer = Math.max(1, Math.floor(options.maxBuffer ?? 50));
    this.maxChunkChars = Math.max(256, Math.floor(options.maxChunkChars ?? 16_384));
    this.logger = options.logger ?? null;
  }

  push(description: string, originator?: string): void {
    this.buffer.push({
      description: this.boundDescription(description),
      originator,
      createTime: new Date().toISOString(),
    });
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
    const batch = this.compactBatch(this.buffer);
    this.buffer = [];
    try {
      this.sink.appendActivities(this.sessionId, batch);
    } catch (error) {
      this.logger?.warn("activity_write_coalescer_flush_failed", {
        sessionId: this.sessionId,
        batchSize: batch.length,
        error,
      });
      // Activity persistence is best-effort; never let it break the provider run.
    }
  }

  /**
   * Provider CLIs commonly emit one stdout fragment per line. Keeping every fragment as a
   * separate SQLite row amplifies the same stream again when session sync mirrors it into the
   * execution feed. Compact only adjacent rows from the same originator, preserving ordering and
   * the first timestamp while keeping rows bounded for dashboard reads.
   */
  private compactBatch(
    batch: Array<{ originator?: string; description: string; createTime: string }>,
  ): Array<{ originator?: string; description: string; createTime: string }> {
    const compacted: Array<{ originator?: string; description: string; createTime: string }> = [];
    for (const item of batch) {
      const previous = compacted.at(-1);
      const separator = previous?.description ? "\n" : "";
      if (
        previous
        && previous.originator === item.originator
        && previous.description.length + separator.length + item.description.length <= this.maxChunkChars
      ) {
        previous.description += `${separator}${item.description}`;
        continue;
      }
      compacted.push({ ...item });
    }
    return compacted;
  }

  private boundDescription(description: string): string {
    if (description.length <= this.maxChunkChars) {
      return description;
    }
    const marker = "\n… [activity truncated] …\n";
    const retainedChars = Math.max(this.maxChunkChars - marker.length, 0);
    const headChars = Math.ceil(retainedChars / 2);
    const tailChars = retainedChars - headChars;
    return `${description.slice(0, headChars)}${marker}${tailChars > 0 ? description.slice(-tailChars) : ""}`
      .slice(0, this.maxChunkChars);
  }

  /** Flush any remaining buffered activities and cancel the pending timer. */
  stop(): void {
    this.flush();
  }

  /** Alias for callers that model shutdown as an explicit drain. */
  drain(): void {
    this.flush();
  }
}
