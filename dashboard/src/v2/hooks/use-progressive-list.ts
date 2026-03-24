import { useEffect, useRef, useState } from "preact/hooks";
import { type PageSizeOption, resolvePageSize, shouldResetVisibleCount } from "../lib/progressive-list-options.js";

export interface UseProgressiveListOptions {
  pageSize?: PageSizeOption;
  stepCount?: number;
  rootMargin?: string;
}

/**
 * Progressively renders a list of items to keep the UI responsive.
 * Implemented with an IntersectionObserver to load more items when reaching the sentinel.
 */
export function useProgressiveList<T>(
  items: T[],
  options: UseProgressiveListOptions = {}
) {
  const {
    pageSize = "20",
    stepCount = 20,
    rootMargin = "120px 0px 120px 0px",
  } = options;

  const previousLengthRef = useRef(items.length);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const initialCount = resolvePageSize(pageSize, items.length);
  const [visibleCount, setVisibleCount] = useState(initialCount);

  // Handle data or page size changes deterministically
  useEffect(() => {
    const prevLength = previousLengthRef.current;
    const newLength = items.length;

    // We must reset if the user chose "All" or a size change happened.
    // Or if the array changes so that it's smaller, etc.
    if (pageSize === "All" || shouldResetVisibleCount(prevLength, newLength, visibleCount)) {
      setVisibleCount(resolvePageSize(pageSize, newLength));
    } else {
      // If we didn't reset entirely, ensure we don't display more items than exist
      setVisibleCount((prev) => Math.min(prev, newLength));
    }

    previousLengthRef.current = newLength;
  }, [items.length, pageSize, visibleCount]);

  // Set up the IntersectionObserver for scroll-based loading
  useEffect(() => {
    // If we're displaying everything, no need for an observer.
    if (pageSize === "All" || visibleCount >= items.length) {
      return;
    }

    const sentinel = sentinelRef.current;
    const root = scrollContainerRef.current;

    if (!sentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + stepCount, items.length));
        }
      },
      { root, rootMargin }
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [items.length, visibleCount, pageSize, stepCount, rootMargin]);

  return {
    visibleItems: items.slice(0, visibleCount),
    visibleCount,
    hasMore: visibleCount < items.length && pageSize !== "All",
    scrollContainerRef,
    sentinelRef,
  };
}
