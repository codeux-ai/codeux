import { useEffect, useRef } from "preact/hooks";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(active: boolean, onClose?: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return;

    triggerRef.current = document.activeElement as HTMLElement | null;

    const focusTimer = window.setTimeout(() => {
      if (!containerRef.current) return;
      const autoFocusTarget = containerRef.current.querySelector("[autofocus]") as HTMLElement | null;
      const focusableElements = Array.from(
        containerRef.current.querySelectorAll(FOCUSABLE_SELECTOR)
      ) as HTMLElement[];
      const initialTarget = autoFocusTarget ?? focusableElements[0];
      initialTarget?.focus();
    }, 50);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current?.();
        return;
      }

      if (event.key === "Tab") {
        if (!containerRef.current) return;

        const focusableElements = Array.from(
          containerRef.current.querySelectorAll(FOCUSABLE_SELECTOR)
        ) as HTMLElement[];

        if (focusableElements.length === 0) return;

        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];

        // If focus escapes the modal, force it back
        if (!containerRef.current.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
          return;
        }

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      if (triggerRef.current) {
        triggerRef.current.focus();
      }
    };
  }, [active]);

  return containerRef;
}
