import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { X, Plus, Target, CalendarDays, Sparkles, Loader2, FileText } from "lucide-preact";
import type { Sprint } from "../../types.js";

interface AddSprintModalProps {
    nextId: string;
    onClose: () => void;
    onAdd: (sprint: Sprint) => void;
}

const formatDateLabel = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export const AddSprintModal: FunctionComponent<AddSprintModalProps> = ({ nextId, onClose, onAdd }) => {
    const backdropRef = useRef<HTMLDivElement>(null);
    const cardRef     = useRef<HTMLDivElement>(null);
    const fieldsRef   = useRef<HTMLDivElement>(null);

    const [name, setName]               = useState('');
    const [startDate, setStartDate]     = useState('');
    const [endDate, setEndDate]         = useState('');
    const [description, setDescription] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);

    // Entrance — useLayoutEffect so initial from-state is set before first paint
    useLayoutEffect(() => {
        gsap.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: "power2.out" });
        gsap.fromTo(cardRef.current,
            { y: 48, opacity: 0, scale: 0.94 },
            { y: 0, opacity: 1, scale: 1, duration: 0.6, ease: "power4.out", delay: 0.05 }
        );
        if (fieldsRef.current) {
            gsap.fromTo(Array.from(fieldsRef.current.children),
                { y: 18, opacity: 0 },
                { y: 0, opacity: 1, stagger: 0.07, duration: 0.45, ease: "power3.out", delay: 0.25 }
            );
        }
    }, []);

    const handleClose = () => {
        gsap.to(cardRef.current, { y: 24, opacity: 0, scale: 0.96, duration: 0.28, ease: "power3.in" });
        gsap.to(backdropRef.current, { opacity: 0, duration: 0.28, delay: 0.05, onComplete: onClose });
    };

    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    const handleBackdropClick = (e: MouseEvent) => {
        if (e.target === backdropRef.current) handleClose();
    };

    const handleSubmit = (e: Event) => {
        e.preventDefault();
        if (!name.trim() || !startDate || !endDate) return;
        onAdd({
            id: nextId.toLowerCase(),
            name: name.trim(),
            date: `${formatDateLabel(startDate)} - ${formatDateLabel(endDate)}`,
            tasksCount: 0,
            completion: 0,
            status: 'idle',
        });
        handleClose();
    };

    return (
        <div
            ref={backdropRef}
            onClick={handleBackdropClick}
            className="fixed inset-0 z-[200] flex items-center justify-center px-6 bg-black/50 dark:bg-black/70 backdrop-blur-xl"
        >
            <div
                ref={cardRef}
                className="relative w-full max-w-2xl overflow-hidden rounded-[2.5rem] shadow-[0_48px_96px_rgba(0,0,0,0.25)] dark:shadow-[0_48px_96px_rgba(0,0,0,0.7)] flex"
                style={{ minHeight: '540px' }}
            >
                {/* ── Left decorative panel ── */}
                <div className="relative w-52 shrink-0 bg-void-900 dark:bg-void-950 flex flex-col justify-between p-8 overflow-hidden">
                    <span className="absolute -top-2 -left-4 text-[7.5rem] font-black text-white/[0.035] font-display leading-none pointer-events-none select-none tracking-tighter">
                        NEW
                    </span>
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-44 h-44 bg-signal-500/[0.08] animate-organic" style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%' }} />
                        <div className="absolute w-32 h-32 bg-signal-500/[0.12] animate-organic-reverse" style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%' }} />
                        <div className="absolute w-20 h-20 bg-signal-500/[0.18] animate-organic" style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%' }} />
                    </div>
                    <div className="relative z-10 flex items-center gap-2 text-signal-500 font-mono font-bold text-[10px] tracking-[0.2em] uppercase">
                        <Target className="w-3.5 h-3.5" strokeWidth={2.5} />
                        New Sprint
                    </div>
                    <div className="relative z-10">
                        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/25 font-mono mb-1.5">Sprint ID</div>
                        <div className="text-4xl font-black text-white font-mono tracking-tighter leading-none">
                            {nextId.toUpperCase()}
                        </div>
                        <div className="mt-3 w-8 h-[2px] bg-signal-500/50" />
                    </div>
                </div>

                {/* ── Right form panel ── */}
                <div className="flex-1 bg-white/98 dark:bg-void-800/98 p-8 flex flex-col">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-8">
                        <div>
                            <h2 className="text-[2rem] font-black text-slate-900 dark:text-white tracking-tight font-display leading-none">
                                Launch Sprint.
                            </h2>
                            <p className="text-xs font-medium text-slate-400 mt-2 tracking-wide">
                                Define the next iteration cycle
                            </p>
                        </div>
                        <button
                            onClick={handleClose}
                            className="w-9 h-9 flex items-center justify-center rounded-full bg-black/[0.05] dark:bg-white/[0.05] hover:bg-black/10 dark:hover:bg-white/10 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all shrink-0"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="flex flex-col flex-1">
                        <div ref={fieldsRef} className="flex flex-col gap-6 flex-1">

                            {/* Sprint Name */}
                            <div className="group/field">
                                <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 group-focus-within/field:text-signal-600 dark:group-focus-within/field:text-signal-400 transition-colors">
                                    Sprint Name
                                </label>
                                <input
                                    type="text"
                                    value={name}
                                    onInput={(e) => setName((e.target as HTMLInputElement).value)}
                                    placeholder="Authentication Overhaul"
                                    className="mt-2.5 w-full bg-transparent border-0 border-b-2 border-black/[0.08] dark:border-white/[0.08] focus:border-signal-500 dark:focus:border-signal-500 pb-2.5 text-[1.6rem] font-black text-slate-900 dark:text-white placeholder-slate-200 dark:placeholder-slate-700 focus:outline-none transition-colors font-display tracking-tight leading-none"
                                    required
                                    autoFocus
                                />
                            </div>

                            {/* Date range */}
                            <div className="grid grid-cols-2 gap-5">
                                <div className="group/field">
                                    <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 group-focus-within/field:text-signal-600 dark:group-focus-within/field:text-signal-400 transition-colors flex items-center gap-1.5">
                                        <CalendarDays className="w-3 h-3" /> Start Date
                                    </label>
                                    <input
                                        type="date"
                                        value={startDate}
                                        onInput={(e) => setStartDate((e.target as HTMLInputElement).value)}
                                        className="mt-2.5 w-full bg-transparent border-0 border-b-2 border-black/[0.08] dark:border-white/[0.08] focus:border-signal-500 dark:focus:border-signal-500 pb-2.5 text-sm font-mono font-semibold text-slate-700 dark:text-slate-300 focus:outline-none transition-colors"
                                        required
                                    />
                                </div>
                                <div className="group/field">
                                    <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 group-focus-within/field:text-signal-600 dark:group-focus-within/field:text-signal-400 transition-colors flex items-center gap-1.5">
                                        <CalendarDays className="w-3 h-3" /> End Date
                                    </label>
                                    <input
                                        type="date"
                                        value={endDate}
                                        onInput={(e) => setEndDate((e.target as HTMLInputElement).value)}
                                        className="mt-2.5 w-full bg-transparent border-0 border-b-2 border-black/[0.08] dark:border-white/[0.08] focus:border-signal-500 dark:focus:border-signal-500 pb-2.5 text-sm font-mono font-semibold text-slate-700 dark:text-slate-300 focus:outline-none transition-colors"
                                        required
                                    />
                                </div>
                            </div>

                            {/* Description + AI — fills remaining space */}
                            <div className="flex flex-col flex-1 min-h-0">
                                {/* Label row with AI button */}
                                <div className="flex items-center justify-between mb-2.5">
                                    <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 flex items-center gap-1.5">
                                        <FileText className="w-3 h-3" /> Description
                                    </label>

                                    {/* AI generate button */}
                                    <button
                                        type="button"
                                        disabled={isGenerating}
                                        onClick={() => setIsGenerating(g => !g)}
                                        className={`group/ai flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-[0.15em] border transition-all duration-300 ${
                                            isGenerating
                                                ? 'bg-signal-500/[0.06] border-signal-500/30 text-signal-500/60 cursor-not-allowed'
                                                : 'bg-signal-500/[0.07] border-signal-500/25 text-signal-600 dark:text-signal-400 hover:bg-signal-500/[0.14] hover:border-signal-500/55 hover:shadow-[0_0_14px_rgba(0,224,160,0.2)] hover:-translate-y-px'
                                        }`}
                                    >
                                        {isGenerating
                                            ? <Loader2 className="w-3 h-3 animate-spin" />
                                            : <Sparkles className="w-3 h-3 group-hover/ai:scale-110 transition-transform duration-200" />
                                        }
                                        {isGenerating ? 'Generating...' : 'Generate with AI'}
                                    </button>
                                </div>

                                {/* Textarea with generating overlay */}
                                <div className={`relative flex-1 transition-all duration-500 rounded-2xl ${
                                    isGenerating
                                        ? 'shadow-[0_0_0_1.5px_rgba(0,224,160,0.45),0_0_24px_rgba(0,224,160,0.12)]'
                                        : ''
                                }`}>
                                    <textarea
                                        value={description}
                                        onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
                                        placeholder={isGenerating ? '' : "Describe your sprint goals, paste a brief idea, or write a rough scope — AI will shape it into a full sprint description."}
                                        className={`w-full h-full min-h-[128px] bg-black/[0.025] dark:bg-white/[0.03] border rounded-2xl p-4 text-sm text-slate-700 dark:text-slate-300 placeholder-slate-300 dark:placeholder-slate-600 focus:outline-none resize-none leading-relaxed transition-all duration-300 ${
                                            isGenerating
                                                ? 'border-signal-500/40 dark:border-signal-500/30'
                                                : 'border-black/[0.07] dark:border-white/[0.07] focus:border-signal-500/50 dark:focus:border-signal-500/40'
                                        }`}
                                    />

                                    {/* Generating shimmer — three scanning lines */}
                                    {isGenerating && (
                                        <div className="absolute inset-0 rounded-2xl pointer-events-none overflow-hidden">
                                            <div className="absolute inset-x-4 h-px bg-gradient-to-r from-transparent via-signal-500/70 to-transparent animate-pulse" style={{ top: '28%' }} />
                                            <div className="absolute inset-x-4 h-px bg-gradient-to-r from-transparent via-signal-500/50 to-transparent animate-pulse" style={{ top: '52%', animationDelay: '0.35s' }} />
                                            <div className="absolute inset-x-4 h-px bg-gradient-to-r from-transparent via-signal-500/30 to-transparent animate-pulse" style={{ top: '76%', animationDelay: '0.7s' }} />
                                            {/* Corner cursor blink */}
                                            <div className="absolute top-4 left-4 w-[2px] h-4 bg-signal-500 animate-[blink_1s_step-end_infinite] rounded-full" />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center justify-between pt-1">
                                <button
                                    type="button"
                                    onClick={handleClose}
                                    className="text-sm font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="group/btn flex items-center gap-2.5 px-6 py-3 bg-signal-500 hover:bg-signal-400 text-void-900 font-bold text-sm rounded-2xl transition-all duration-300 shadow-[0_4px_20px_rgba(0,224,160,0.3)] hover:shadow-[0_8px_32px_rgba(0,224,160,0.45)] hover:-translate-y-px"
                                >
                                    <Plus className="w-4 h-4 group-hover/btn:rotate-90 transition-transform duration-300" />
                                    Launch Sprint
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};
