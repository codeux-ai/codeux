/**
 * Debounces GitHub `mergeStateStatus === "DIRTY"` readings before they are
 * treated as a real merge conflict.
 *
 * GitHub reports a PR as `DIRTY`/`UNKNOWN` *transiently* right after its head
 * branch is pushed or its base branch advances, while it recomputes
 * mergeability — and frequently flips back to a mergeable state a cycle later.
 * Acting on a single `DIRTY` reading therefore escalates phantom conflicts: the
 * gate spins up a worker to "resolve" a conflict that never existed and (for the
 * main merge) can pause the whole sprint, only for the PR to merge cleanly
 * moments later.
 *
 * This debouncer requires `DIRTY` to be observed on `threshold` consecutive
 * cycles for the same PR before a conflict is confirmed; any non-`DIRTY` reading
 * clears the streak. A per-cycle generation guard keeps {@link observe}
 * idempotent within a cycle, so multiple call sites can observe the same PR in
 * the same cycle without double-counting the streak.
 */
export class MergeConflictDebouncer {
  private generation = 0;
  private readonly state = new Map<string, { streak: number; lastGeneration: number }>();

  constructor(private readonly threshold = 2) {}

  /** Advance to a new cycle. Call once at the start of each orchestration cycle. */
  beginCycle(): void {
    this.generation++;
  }

  /**
   * Record this cycle's mergeable state for a PR and report whether a *confirmed*
   * (debounced) conflict currently stands. Idempotent within a cycle: repeated
   * calls with the same `DIRTY` state in one cycle do not advance the streak.
   *
   * Falls back to the raw `DIRTY` signal when no stable PR key is available.
   */
  observe(prKey: string | null | undefined, mergeStateStatus: string | null | undefined): boolean {
    const isDirty = mergeStateStatus === "DIRTY";
    if (!prKey) {
      return isDirty;
    }
    if (!isDirty) {
      this.state.delete(prKey);
      return false;
    }

    const entry = this.state.get(prKey);
    if (!entry) {
      this.state.set(prKey, { streak: 1, lastGeneration: this.generation });
      return 1 >= this.threshold;
    }
    if (entry.lastGeneration !== this.generation) {
      entry.streak += 1;
      entry.lastGeneration = this.generation;
    }
    return entry.streak >= this.threshold;
  }

  /** Forget any tracked streak for a PR (e.g. once it has merged). */
  reset(prKey: string | null | undefined): void {
    if (prKey) {
      this.state.delete(prKey);
    }
  }
}
