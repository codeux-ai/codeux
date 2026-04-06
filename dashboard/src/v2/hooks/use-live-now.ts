import { useState, useEffect } from "preact/hooks";

let sharedNow = Date.now();
let subscribers = new Set<() => void>();
let timerId: number | null = null;

function startTimer() {
    if (!timerId && typeof window !== "undefined") {
        timerId = window.setInterval(() => {
            sharedNow = Date.now();
            subscribers.forEach(cb => cb());
        }, 1000);
    }
}

function stopTimer() {
    if (timerId && subscribers.size === 0) {
        window.clearInterval(timerId);
        timerId = null;
    }
}

/**
 * A shared clock hook to advance live-session timers from one tick source.
 * This prevents components from owning their own independent intervals.
 */
// Exported strictly for testing purposes to reset the clock between isolated runs.
export function resetLiveNowClockForTesting() {
    sharedNow = Date.now();
    subscribers.clear();
    if (timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
    }
}

export function useLiveNow(enabled = true): number {
    // If the system clock (Date.now) deviates significantly from the cached sharedNow
    // (e.g. because of vi.useFakeTimers or waking from sleep), pull the latest directly.
    const initialNow = Math.abs(Date.now() - sharedNow) > 5000 ? Date.now() : sharedNow;
    const [now, setNow] = useState(initialNow);

    useEffect(() => {
        if (!enabled) return;

        // Ensure we are synced to the current time immediately upon enabling.
        // This resolves issues where component mount is delayed or mock timers advanced prior to mount.
        const current = Date.now();
        // Check `sharedNow` instead of `now` to avoid relying on `now` state in dependencies.
        if (Math.abs(current - sharedNow) > 1000) {
            setNow(current);
            sharedNow = current; // Best effort sync for other subscribers
        }

        const update = () => setNow(sharedNow);
        subscribers.add(update);
        startTimer();

        return () => {
            subscribers.delete(update);
            if (subscribers.size === 0) {
                stopTimer();
            }
        };
    }, [enabled]);

    return now;
}
