const fs = require('fs');
const file = 'dashboard/src/v2/components/ui/AddProjectModal.tsx';
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

        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                handleClose();
            } else if (e.key === 'Tab') {
                if (!cardRef.current) return;
                const focusableElements = Array.from(cardRef.current.querySelectorAll(FOCUSABLE_SELECTOR)) as HTMLElement[];
                if (focusableElements.length === 0) return;

                const first = focusableElements[0];
                const last = focusableElements[focusableElements.length - 1];

                if (!cardRef.current.contains(document.activeElement)) {
                    e.preventDefault();
                    first.focus();
                    return;
                }

                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };
        document.addEventListener('keydown', handler);
        return () => {
            document.removeEventListener('keydown', handler);
            if (triggerRef.current) {
                triggerRef.current.focus();
            }
        };
    }, []);
`;

const lines = content.split('\n');
const useEffectIndexStart = lines.findIndex(line => line.includes("const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };"));

if (useEffectIndexStart !== -1) {
    // Replace the existing useEffect
    lines.splice(useEffectIndexStart - 1, 5, focusTrapCode);
} else {
    console.log("Could not find useEffect in AddProjectModal.tsx");
}

fs.writeFileSync(file, lines.join('\n'));
