import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { X, Plus, FolderOpen, GitBranch, FolderInput, Link2 } from "lucide-preact";

interface AddProjectModalProps {
    onClose: () => void;
    onAdd: (project: { name: string; type: 'local' | 'git'; path: string; cloneDir?: string }) => void;
}

type SourceType = 'local' | 'git';

export const AddProjectModal: FunctionComponent<AddProjectModalProps> = ({ onClose, onAdd }) => {
    const backdropRef = useRef<HTMLDivElement>(null);
    const cardRef     = useRef<HTMLDivElement>(null);
    const fieldsRef   = useRef<HTMLDivElement>(null);
    const triggerRef  = useRef<HTMLElement | null>(null);

    const [name, setName]           = useState('');
    const [sourceType, setSourceType] = useState<SourceType>('local');
    const [localPath, setLocalPath] = useState('');
    const [gitUrl, setGitUrl]       = useState('');
    const [cloneDir, setCloneDir]   = useState('');

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
        triggerRef.current = document.activeElement as HTMLElement | null;

        const getFocusableElements = () => {
            if (!cardRef.current) return [];
            return Array.from(cardRef.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')) as HTMLElement[];
        };

        if (cardRef.current) {
            const focusableElements = getFocusableElements();
            if (focusableElements.length > 0) {
                focusableElements[0].focus();
            }
        }

        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                handleClose();
            } else if (e.key === 'Tab') {
                if (!cardRef.current) return;
                const focusableElements = getFocusableElements();
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
    }, [handleClose]);

    const handleBackdropClick = (e: MouseEvent) => {
        if (e.target === backdropRef.current) handleClose();
    };

    const handleSubmit = (e: Event) => {
        e.preventDefault();
        const path = sourceType === 'local' ? localPath.trim() : gitUrl.trim();
        if (!name.trim() || !path) return;
        onAdd({
            name: name.trim(),
            type: sourceType,
            path,
            ...(sourceType === 'git' && cloneDir.trim() ? { cloneDir: cloneDir.trim() } : {}),
        });
        handleClose();
    };

    // Re-animate fields when source type changes
    const handleSourceTypeChange = (type: SourceType) => {
        setSourceType(type);
        if (fieldsRef.current) {
            const conditionalFields = Array.from(fieldsRef.current.children).slice(2);
            gsap.fromTo(conditionalFields,
                { y: 12, opacity: 0 },
                { y: 0, opacity: 1, stagger: 0.06, duration: 0.35, ease: "power3.out" }
            );
        }
    };

    return (
        <div
            ref={backdropRef}
            onClick={handleBackdropClick}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-project-modal-title"
            className="fixed inset-0 z-[200] flex items-center justify-center px-6 bg-black/50 dark:bg-black/70 backdrop-blur-xl"
        >
            <div
                ref={cardRef}
                className="relative w-full max-w-2xl overflow-hidden rounded-[2.5rem] shadow-[0_48px_96px_rgba(0,0,0,0.25)] dark:shadow-[0_48px_96px_rgba(0,0,0,0.7)] flex"
                style={{ minHeight: '520px' }}
            >
                {/* ── Left decorative panel ── */}
                <div className="relative w-52 shrink-0 bg-void-900 dark:bg-void-950 flex flex-col justify-between p-8 overflow-hidden">
                    <span className="absolute -top-2 -left-4 text-[7.5rem] font-black text-white/[0.035] font-display leading-none pointer-events-none select-none tracking-tighter">
                        ADD
                    </span>
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-44 h-44 bg-ember-500/[0.08] animate-organic" style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%' }} />
                        <div className="absolute w-32 h-32 bg-ember-500/[0.12] animate-organic-reverse" style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%' }} />
                        <div className="absolute w-20 h-20 bg-ember-500/[0.18] animate-organic" style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%' }} />
                    </div>
                    <div className="relative z-10 flex items-center gap-2 text-ember-500 font-mono font-bold text-[10px] tracking-[0.2em] uppercase">
                        <FolderOpen className="w-3.5 h-3.5" strokeWidth={2.5} />
                        New Project
                    </div>
                    <div className="relative z-10">
                        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/25 font-mono mb-1.5">Source</div>
                        <div className="text-lg font-black text-white font-mono tracking-tight leading-snug">
                            {sourceType === 'git' ? 'Git Repo' : 'Local Path'}
                        </div>
                        <div className="mt-3 w-8 h-[2px] bg-ember-500/50" />
                    </div>
                </div>

                {/* ── Right form panel ── */}
                <div className="flex-1 bg-white/98 dark:bg-void-800/98 p-8 flex flex-col">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-8">
                        <div>
                            <h2 id="add-project-modal-title" className="text-[2rem] font-black text-slate-900 dark:text-white tracking-tight font-display leading-none">
                                Add Project.
                            </h2>
                            <p className="text-xs font-medium text-slate-400 mt-2 tracking-wide">
                                Connect a local directory or remote repository
                            </p>
                        </div>
                        <button
                            onClick={handleClose}
                            aria-label="Close"
                            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 w-9 h-9 flex items-center justify-center rounded-full bg-black/[0.05] dark:bg-white/[0.05] hover:bg-black/10 dark:hover:bg-white/10 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all shrink-0"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="flex flex-col flex-1">
                        <div ref={fieldsRef} className="flex flex-col gap-6 flex-1">

                            {/* Project Name */}
                            <div className="group/field">
                                <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 group-focus-within/field:text-ember-600 dark:group-focus-within/field:text-ember-400 transition-colors">
                                    Project Name
                                </label>
                                <input
                                    type="text"
                                    value={name}
                                    onInput={(e) => setName((e.target as HTMLInputElement).value)}
                                    placeholder="My Awesome Project"
                                    className="mt-2.5 w-full bg-transparent border-0 border-b-2 border-black/[0.08] dark:border-white/[0.08] focus:border-ember-500 dark:focus:border-ember-500 pb-2.5 text-[1.6rem] font-black text-slate-900 dark:text-white placeholder-slate-200 dark:placeholder-slate-700 focus:outline-none transition-colors font-display tracking-tight leading-none"
                                    required
                                    autoFocus
                                />
                            </div>

                            {/* Source Type Toggle */}
                            <div>
                                <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 block mb-2.5">
                                    Source Type
                                </label>
                                <div className="inline-flex p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-2xl gap-1">
                                    {(['local', 'git'] as SourceType[]).map((type) => (
                                        <button
                                            key={type}
                                            type="button"
                                            onClick={() => handleSourceTypeChange(type)}
                                            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-[0.12em] transition-all duration-250 ${
                                                sourceType === type
                                                    ? 'bg-ember-500 text-void-900 shadow-[0_2px_12px_rgba(255,184,0,0.3)]'
                                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                            }`}
                                        >
                                            {type === 'local'
                                                ? <FolderInput className="w-3.5 h-3.5" strokeWidth={2} />
                                                : <GitBranch className="w-3.5 h-3.5" strokeWidth={2} />
                                            }
                                            {type === 'local' ? 'Local Path' : 'Git URL'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Conditional fields */}
                            {sourceType === 'local' ? (
                                <div className="group/field">
                                    <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 group-focus-within/field:text-ember-600 dark:group-focus-within/field:text-ember-400 transition-colors flex items-center gap-1.5">
                                        <FolderInput className="w-3 h-3" /> Directory Path
                                    </label>
                                    <input
                                        type="text"
                                        value={localPath}
                                        onInput={(e) => setLocalPath((e.target as HTMLInputElement).value)}
                                        placeholder="/home/user/projects/my-project"
                                        className="mt-2.5 w-full bg-transparent border-0 border-b-2 border-black/[0.08] dark:border-white/[0.08] focus:border-ember-500 dark:focus:border-ember-500 pb-2.5 text-sm font-mono font-semibold text-slate-700 dark:text-slate-300 placeholder-slate-300 dark:placeholder-slate-600 focus:outline-none transition-colors"
                                        required
                                    />
                                </div>
                            ) : (
                                <>
                                    <div className="group/field">
                                        <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 group-focus-within/field:text-ember-600 dark:group-focus-within/field:text-ember-400 transition-colors flex items-center gap-1.5">
                                            <Link2 className="w-3 h-3" /> Repository URL
                                        </label>
                                        <input
                                            type="text"
                                            value={gitUrl}
                                            onInput={(e) => setGitUrl((e.target as HTMLInputElement).value)}
                                            placeholder="https://github.com/user/repo.git"
                                            className="mt-2.5 w-full bg-transparent border-0 border-b-2 border-black/[0.08] dark:border-white/[0.08] focus:border-ember-500 dark:focus:border-ember-500 pb-2.5 text-sm font-mono font-semibold text-slate-700 dark:text-slate-300 placeholder-slate-300 dark:placeholder-slate-600 focus:outline-none transition-colors"
                                            required
                                        />
                                    </div>
                                    <div className="group/field">
                                        <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 group-focus-within/field:text-ember-600 dark:group-focus-within/field:text-ember-400 transition-colors flex items-center gap-1.5">
                                            <FolderInput className="w-3 h-3" /> Clone Into Directory
                                            <span className="ml-1 text-slate-300 dark:text-slate-600 normal-case font-medium tracking-normal">(optional)</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={cloneDir}
                                            onInput={(e) => setCloneDir((e.target as HTMLInputElement).value)}
                                            placeholder="/home/user/projects"
                                            className="mt-2.5 w-full bg-transparent border-0 border-b-2 border-black/[0.08] dark:border-white/[0.08] focus:border-ember-500 dark:focus:border-ember-500 pb-2.5 text-sm font-mono font-semibold text-slate-700 dark:text-slate-300 placeholder-slate-300 dark:placeholder-slate-600 focus:outline-none transition-colors"
                                        />
                                    </div>
                                </>
                            )}

                            {/* Spacer */}
                            <div className="flex-1" />

                            {/* Actions */}
                            <div className="flex items-center justify-between pt-1">
                                <button
                                    type="button"
                                    onClick={handleClose}
                                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 rounded-sm text-sm font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 group/btn flex items-center gap-2.5 px-6 py-3 bg-ember-500 hover:bg-ember-400 text-void-900 font-bold text-sm rounded-2xl transition-all duration-300 shadow-[0_4px_20px_rgba(255,184,0,0.25)] hover:shadow-[0_8px_32px_rgba(255,184,0,0.4)] hover:-translate-y-px"
                                >
                                    <Plus className="w-4 h-4 group-hover/btn:rotate-90 transition-transform duration-300" />
                                    Add Project
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};
