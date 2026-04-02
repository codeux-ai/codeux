import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";

interface ConfirmationDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: "destructive" | "neutral";
    onConfirm: () => void;
    onCancel: () => void;
}

export const ConfirmationDialog: FunctionComponent<ConfirmationDialogProps> = ({
    isOpen,
    title,
    message,
    confirmText = "Confirm",
    cancelText = "Cancel",
    variant = "neutral",
    onConfirm,
    onCancel,
}) => {
    const cardRef = useRef<HTMLDivElement>(null);

    const handleClose = () => {
        if (cardRef.current && backdropRef.current) {
            gsap.to(cardRef.current, { y: 24, opacity: 0, scale: 0.96, duration: 0.28, ease: "power3.in" });
            gsap.to(backdropRef.current, { opacity: 0, duration: 0.28, delay: 0.05, onComplete: onCancel });
        } else {
            onCancel();
        }
    };

    const handleConfirm = () => {
        if (cardRef.current && backdropRef.current) {
            gsap.to(cardRef.current, { y: 24, opacity: 0, scale: 0.96, duration: 0.28, ease: "power3.in" });
            gsap.to(backdropRef.current, { opacity: 0, duration: 0.28, delay: 0.05, onComplete: onConfirm });
        } else {
            onConfirm();
        }
    };

    const backdropRef = useFocusTrap(isOpen, handleClose);

    useLayoutEffect(() => {
        if (isOpen) {
            if (backdropRef.current) {
                gsap.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: "power2.out" });
            }
            if (cardRef.current) {
                gsap.fromTo(
                    cardRef.current,
                    { y: 48, opacity: 0, scale: 0.94 },
                    { y: 0, opacity: 1, scale: 1, duration: 0.6, ease: "power4.out", delay: 0.05 }
                );
            }
        }
    }, [isOpen]);

    const handleBackdropClick = (e: MouseEvent) => {
        if (e.target === backdropRef.current) handleClose();
    };

    if (!isOpen) {
        return null;
    }

    const confirmButtonClass = variant === "destructive"
        ? "bg-red-500 hover:bg-red-600 text-white shadow-[0_4px_20px_rgba(239,68,68,0.25)] hover:shadow-[0_8px_32px_rgba(239,68,68,0.4)] focus-visible:ring-red-500"
        : "bg-ember-500 hover:bg-ember-400 text-void-900 shadow-[0_4px_20px_rgba(255,184,0,0.25)] hover:shadow-[0_8px_32px_rgba(255,184,0,0.4)] focus-visible:ring-ember-500";

    return (
        <div
            ref={backdropRef}
            onClick={handleBackdropClick}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirmation-dialog-title"
            aria-describedby="confirmation-dialog-message"
            className="fixed inset-0 z-[200] flex items-center justify-center px-6 bg-black/50 dark:bg-black/70 backdrop-blur-xl"
        >
            <div
                ref={cardRef}
                className="relative w-full max-w-md overflow-hidden rounded-[2.5rem] shadow-[0_48px_96px_rgba(0,0,0,0.25)] dark:shadow-[0_48px_96px_rgba(0,0,0,0.7)] flex flex-col bg-white dark:bg-void-900 border border-black/[0.08] dark:border-white/[0.08]"
            >
                <div className="p-8 pb-6">
                    <h2 id="confirmation-dialog-title" className="text-2xl font-black text-slate-900 dark:text-white font-display tracking-tight mb-3">
                        {title}
                    </h2>
                    <p id="confirmation-dialog-message" className="text-slate-600 dark:text-slate-400 leading-relaxed font-medium">
                        {message}
                    </p>
                </div>

                <div className="flex items-center justify-end gap-3 px-8 pb-8 pt-2">
                    <button
                        type="button"
                        onClick={handleClose}
                        className="px-5 py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 rounded-xl"
                    >
                        {cancelText}
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        className={`px-6 py-2.5 font-bold text-sm rounded-xl transition-all duration-300 hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 ${confirmButtonClass}`}
                        autoFocus
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};
