import { useEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(active: boolean, onClose?: () => void, providedRef?: RefObject<HTMLElement | HTMLDivElement>) {
  const defaultRef = useRef<HTMLDivElement>(null);
  const containerRef = providedRef || defaultRef;
  const triggerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return;

    triggerRef.current = document.activeElement as HTMLElement | null;

    if (containerRef.current) {
      setTimeout(() => {
        if (!containerRef.current) return;
        const focusableElements = Array.from(
          containerRef.current.querySelectorAll(FOCUSABLE_SELECTOR)
        ) as HTMLElement[];
        if (focusableElements.length > 0) {
          focusableElements[0].focus();
        }
      }, 50);
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (onCloseRef.current) onCloseRef.current();
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
      document.removeEventListener("keydown", handleKeyDown);
      if (triggerRef.current) {
        triggerRef.current.focus();
      }
    };
  }, [active, containerRef]);

  return containerRef;
}
