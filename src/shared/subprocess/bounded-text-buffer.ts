/**
 * Append-efficient tail buffer. Unlike repeated `text += chunk; text =
 * text.slice(-limit)`, append cost does not copy the complete retained tail on
 * every process data event.
 */
export class BoundedTextBuffer {
  private chunks: string[] = [];
  private head = 0;
  private retainedChars = 0;
  private clippedValue = false;

  constructor(private readonly maxChars: number) {}

  get clipped(): boolean {
    return this.clippedValue;
  }

  get length(): number {
    return this.retainedChars;
  }

  append(value: string): void {
    if (!value) {
      return;
    }
    if (this.maxChars <= 0) {
      this.clippedValue = true;
      return;
    }
    this.chunks.push(value);
    this.retainedChars += value.length;
    while (this.retainedChars > this.maxChars && this.head < this.chunks.length) {
      const excess = this.retainedChars - this.maxChars;
      const first = this.chunks[this.head]!;
      if (first.length <= excess) {
        this.retainedChars -= first.length;
        this.head += 1;
      } else {
        this.chunks[this.head] = first.slice(excess);
        this.retainedChars -= excess;
      }
      this.clippedValue = true;
    }
    if (this.head > 128 && this.head * 2 > this.chunks.length) {
      this.chunks = this.chunks.slice(this.head);
      this.head = 0;
    }
  }

  toString(): string {
    if (this.retainedChars === 0) {
      return "";
    }
    if (this.head === 0 && this.chunks.length === 1) {
      return this.chunks[0]!;
    }
    const value = this.chunks.slice(this.head).join("");
    // Materialize once and replace the fragmented representation. Repeated
    // telemetry snapshots then return the same string instead of retaining the
    // joined result alongside every source chunk or joining the full tail on
    // every unchanged poll.
    this.chunks = [value];
    this.head = 0;
    return value;
  }

  /**
   * Returns the retained tail and releases all backing chunks immediately.
   * Final command results use this so IPC/result serialization does not keep a
   * second complete chunk representation alive until child listeners are GC'd.
   */
  takeString(): string {
    const value = this.toString();
    this.chunks = [];
    this.head = 0;
    this.retainedChars = 0;
    return value;
  }
}
