const fs = require('fs');
const file = 'dashboard/src/v2/components/ui/SprintMarkdownModal.tsx';
let content = fs.readFileSync(file, 'utf8');

const focusTrapCode = `
  const FOCUSABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;

    if (cardRef.current) {
      const focusableElements = Array.from(cardRef.current.querySelectorAll(FOCUSABLE_SELECTOR)) as HTMLElement[];
      if (focusableElements.length > 0) {
        focusableElements[0].focus();
      }
    }

    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "Tab") {
        if (!cardRef.current) return;
        const focusableElements = Array.from(cardRef.current.querySelectorAll(FOCUSABLE_SELECTOR)) as HTMLElement[];
        if (focusableElements.length === 0) return;

        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];

        if (!cardRef.current.contains(document.activeElement)) {
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
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      if (triggerRef.current) {
        triggerRef.current.focus();
      }
    };
  }, [onClose]);
`;

let lines = content.split('\n');
const useEffectIndexStart = lines.findIndex(line => line.includes('const handler = (event: KeyboardEvent) => {'));
if (useEffectIndexStart !== -1) {
    // Replace the existing useEffect
    lines.splice(useEffectIndexStart - 1, 9, focusTrapCode);
} else {
    console.log("Could not find useEffect in SprintMarkdownModal.tsx");
}

content = lines.join('\n');

content = content.replace(
  '<div\n        ref={cardRef}\n        className="relative w-full max-w-5xl overflow-hidden rounded-[2.5rem] shadow-[0_48px_96px_rgba(0,0,0,0.25)] dark:shadow-[0_48px_96px_rgba(0,0,0,0.7)] flex"\n      >',
  '<div\n        ref={cardRef}\n        role="dialog"\n        aria-modal="true"\n        aria-labelledby="sprint-markdown-modal-title"\n        className="relative w-full max-w-5xl overflow-hidden rounded-[2.5rem] shadow-[0_48px_96px_rgba(0,0,0,0.25)] dark:shadow-[0_48px_96px_rgba(0,0,0,0.7)] flex"\n      >'
);

content = content.replace(
  '<h2 className="text-[2rem] font-black text-slate-900 dark:text-white tracking-tight font-display leading-none">',
  '<h2 id="sprint-markdown-modal-title" className="text-[2rem] font-black text-slate-900 dark:text-white tracking-tight font-display leading-none">'
);

fs.writeFileSync(file, content);
