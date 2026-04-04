import { useState, useEffect } from "preact/hooks";

export function useReducedMotion(): boolean {
    const [reducedMotion, setReducedMotion] = useState(() => {
        if (typeof window !== "undefined" && window.matchMedia) {
            return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        }
        return false;
    });

    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) {
            return;
        }

        const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

        // Listen for changes
        const listener = (event: MediaQueryListEvent) => {
            setReducedMotion(event.matches);
        };

        if (mediaQuery.addEventListener) {
            mediaQuery.addEventListener("change", listener);
        } else {
            // Fallback for older browsers
            mediaQuery.addListener(listener);
        }

        return () => {
            if (mediaQuery.removeEventListener) {
                mediaQuery.removeEventListener("change", listener);
            } else {
                // Fallback for older browsers
                mediaQuery.removeListener(listener);
            }
        };
    }, []);

    return reducedMotion;
}
