export class AsyncSemaphore {
  private activeCount = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly capacity: number;

  constructor(capacity: number) {
    const normalizedCapacity = Math.floor(capacity);
    this.capacity = Number.isFinite(normalizedCapacity)
      ? Math.max(1, normalizedCapacity)
      : 1;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.activeCount < this.capacity) {
      this.activeCount += 1;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.activeCount += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.waiters.shift()?.();
  }
}
