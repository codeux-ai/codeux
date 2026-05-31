import { useCallback, useEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";

export function useDropdownKeyboard(
    isOpen: boolean,
    setIsOpen: (open: boolean) => void,
    containerRef: RefObject<HTMLElement>,
    onFilterChange?: (val: string) => void
) {
    const toggleRef = useRef<HTMLButtonElement>(null);

    const onToggleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
            e.preventDefault();
            setIsOpen(!isOpen);
        }
    }, [isOpen, setIsOpen]);

    const onContainerKeyDown = useCallback((e: KeyboardEvent) => {
        if (!isOpen || !containerRef.current) return;

        if (e.key === "Escape") {
            e.preventDefault();
            setIsOpen(false);
            setTimeout(() => toggleRef.current?.focus(), 0);
            return;
        }

        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();

            const focusableElements = Array.from(
                containerRef.current.querySelectorAll<HTMLElement>(
                    'button, a[href], input'
                )
            ).filter(el => el !== toggleRef.current);

            if (focusableElements.length === 0) return;

            const currentIndex = focusableElements.indexOf(document.activeElement as HTMLElement);

            let nextIndex = 0;
            if (e.key === "ArrowDown") {
                nextIndex = currentIndex < focusableElements.length - 1 ? currentIndex + 1 : 0;
            } else if (e.key === "ArrowUp") {
                nextIndex = currentIndex > 0 ? currentIndex - 1 : focusableElements.length - 1;
            }

            focusableElements[nextIndex]?.focus();
        }
    }, [isOpen, setIsOpen, containerRef]);

    useEffect(() => {
        if (isOpen && containerRef.current) {
            // Give the DOM a moment to render the dropdown
            setTimeout(() => {
                if (!containerRef.current) return;
                const focusableElements = Array.from(
                    containerRef.current.querySelectorAll<HTMLElement>(
                        'button, a[href], input'
                    )
                ).filter(el => el !== toggleRef.current);

                if (focusableElements.length > 0) {
                    focusableElements[0]?.focus();
                }
            }, 0);
        } else if (!isOpen) {
            onFilterChange?.("");
            if (toggleRef.current && document.activeElement && containerRef.current?.contains(document.activeElement)) {
                toggleRef.current.focus();
            }
        }
    }, [isOpen, containerRef, onFilterChange]);

    return { toggleRef, onToggleKeyDown, onContainerKeyDown };
}
