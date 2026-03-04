import { describe, it, expect, vi } from 'vitest';
import { waitUntil } from '../../../../src/shared/polling/wait-until.js';

describe('waitUntil', () => {
  it('should resolve when predicate is met', async () => {
    let count = 0;
    const action = async () => {
      count++;
      return count;
    };
    const predicate = (val: number) => val === 3;

    const result = await waitUntil({
      action,
      predicate,
      intervalMs: 10,
      timeoutMs: 100,
    });

    expect(result).toBe(3);
    expect(count).toBe(3);
  });

  it('should timeout if predicate is never met', async () => {
    const action = async () => 'pending';
    const predicate = (val: string) => val === 'done';

    await expect(
      waitUntil({
        action,
        predicate,
        intervalMs: 10,
        timeoutMs: 50,
        description: 'test condition',
      })
    ).rejects.toThrow('Timeout waiting for test condition after 50ms');
  });

  it('should support AbortSignal', async () => {
    const controller = new AbortController();
    const action = async () => 'pending';
    const predicate = () => false;

    setTimeout(() => controller.abort(), 25);

    await expect(
      waitUntil({
        action,
        predicate,
        intervalMs: 10,
        timeoutMs: 100,
        signal: controller.signal,
        description: 'aborted task',
      })
    ).rejects.toThrow('Wait for aborted task aborted');
  });

  it('should call onTimeout when timing out', async () => {
    const onTimeout = vi.fn();
    const action = async () => 'pending';
    const predicate = () => false;

    await expect(
      waitUntil({
        action,
        predicate,
        intervalMs: 10,
        timeoutMs: 50,
        onTimeout,
      })
    ).rejects.toThrow();

    expect(onTimeout).toHaveBeenCalled();
  });

  it('should handle async predicates', async () => {
    const action = async () => 'done';
    const predicate = async (val: string) => {
      await new Promise(resolve => setTimeout(resolve, 5));
      return val === 'done';
    };

    const result = await waitUntil({
      action,
      predicate,
      intervalMs: 10,
      timeoutMs: 100,
    });

    expect(result).toBe('done');
  });
});
