import { useEffect, useRef, useState } from "preact/hooks";

export interface UseProgressiveListOptions {
  initialCount?: number;
  incrementCount?: number;
  delay?: number;
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
    initialCount = 20,
    incrementCount = 20,
    delay = 10,
  } = options;

  const [visibleCount, setVisibleCount] = useState(initialCount);
  const prevLengthRef = useRef(items.length);

  // Only reset visible count on drastic changes (e.g. project switch where the
  // list shrinks to 0 or changes by more than half).  Small changes like a
  // sprint being added/removed should NOT reset — that causes visible flicker
  // as the list briefly collapses and re-expands.
  useEffect(() => {
    const prev = prevLengthRef.current;
    prevLengthRef.current = items.length;

    // List went to 0 (project switch / clear) — reset
    if (items.length === 0) {
      setVisibleCount(initialCount);
      return;
    }

    // List appeared from nothing — reset to start progressive rendering
    if (prev === 0 && items.length > 0) {
      setVisibleCount(initialCount);
      return;
    }

    // Clamp visible count if list shrank below it (e.g. deletion)
    setVisibleCount((current) => Math.min(current, items.length));
  }, [items.length, initialCount]);

  useEffect(() => {
    if (visibleCount >= items.length) {
      return;
    }

    const timer = setTimeout(() => {
      setVisibleCount((prev) => Math.min(prev + incrementCount, items.length));
    }, delay);

    return () => clearTimeout(timer);
  }, [visibleCount, items.length, incrementCount, delay]);

  return items.slice(0, visibleCount);
}
