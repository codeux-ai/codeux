import { useEffect, useRef, useState } from "preact/hooks";
import { DEFAULT_LIST_WINDOW } from "../lib/list-window.js";

export interface UseProgressiveListOptions {
  initialCount?: number;
  incrementCount?: number;
  delay?: number;
  resetKey?: unknown;
}

/**
 * Progressively renders a list of items to keep the UI responsive.
 * Useful for large collections of sprints or tasks.
 */
export function useProgressiveList<T>(
  items: T[],
  options: UseProgressiveListOptions = {}
): T[] {
  const {
    initialCount = DEFAULT_LIST_WINDOW,
    incrementCount = 20,
    delay = 10,
    resetKey,
  } = options;

  const [visibleState, setVisibleState] = useState({
    count: initialCount,
    resetKey,
  });
  const prevLengthRef = useRef(items.length);
  const visibleCount = visibleState.resetKey === resetKey
    ? visibleState.count
    : initialCount;

  // Only reset visible count on drastic changes (e.g. project switch where the
  // list shrinks to 0 or changes by more than half).  Small changes like a
  // sprint being added/removed should NOT reset — that causes visible flicker
  // as the list briefly collapses and re-expands.
  useEffect(() => {
    const prev = prevLengthRef.current;
    prevLengthRef.current = items.length;

    if (visibleState.resetKey !== resetKey) {
      setVisibleState({ count: Math.min(initialCount, items.length), resetKey });
      return;
    }

    // List went to 0 (project switch / clear) — reset
    if (items.length === 0) {
      setVisibleState({ count: initialCount, resetKey });
      return;
    }

    // List appeared from nothing — reset to start progressive rendering
    if (prev === 0 && items.length > 0) {
      setVisibleState({ count: initialCount, resetKey });
      return;
    }

    // Clamp visible count if list shrank below it (e.g. deletion)
    setVisibleState((current) => ({
      resetKey: current.resetKey,
      count: Math.min(current.count, items.length),
    }));
  }, [items.length, initialCount, resetKey, visibleState.resetKey]);

  useEffect(() => {
    if (visibleCount >= items.length) {
      return;
    }

    const timer = setTimeout(() => {
      setVisibleState((prev) => ({
        resetKey: prev.resetKey,
        count: Math.min(prev.count + incrementCount, items.length),
      }));
    }, delay);

    return () => clearTimeout(timer);
  }, [visibleCount, items.length, incrementCount, delay]);

  return items.slice(0, Math.min(visibleCount, items.length));
}
