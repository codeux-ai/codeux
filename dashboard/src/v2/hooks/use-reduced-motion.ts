import { useState, useEffect, useContext } from "preact/hooks";
import { ProjectDataContext } from "../context/project-data.js";
import { useProjectEffectiveSettings } from "./use-project-effective-settings.js";

export function useReducedMotion(): boolean {
    // Tests mock `useProjectData` instead of context directly, but using `ProjectDataContext`
    // breaks tests that mock `../../../dashboard/src/v2/context/project-data.js` and don't export the context symbol.
    // Instead of raw context, we can just safely try to call `useProjectData` or handle errors.
    // However, since `useProjectData` throws if not inside provider, and `useReducedMotion` is used globally, we should just read from local storage or context if available.
    // Wait, the simplest way to avoid the "useProjectData must be used within ProjectDataProvider" error
    // in hooks that are deeply nested (or in tests where the Provider is missing) is to use context directly but NOT throw.
    const projectContext = useContext(ProjectDataContext);
    const selectedProject = projectContext?.selectedProject || null;
    const { data: effectiveSettings } = useProjectEffectiveSettings(selectedProject?.id || null);

    const preference = effectiveSettings?.settings.appearance?.reducedMotion || "AUTO";

    const [systemReducedMotion, setSystemReducedMotion] = useState(() => {
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

        const listener = (event: MediaQueryListEvent) => {
            setSystemReducedMotion(event.matches);
        };

        if (mediaQuery.addEventListener) {
            mediaQuery.addEventListener("change", listener);
        } else {
            mediaQuery.addListener(listener);
        }

        return () => {
            if (mediaQuery.removeEventListener) {
                mediaQuery.removeEventListener("change", listener);
            } else {
                mediaQuery.removeListener(listener);
            }
        };
    }, []);

    if (preference === "REDUCE") return true;
    if (preference === "NONE") return false;
    return systemReducedMotion;
}
