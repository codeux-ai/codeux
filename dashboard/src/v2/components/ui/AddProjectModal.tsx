import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { X, Plus, FolderOpen, GitBranch, FolderInput, Link2 } from "lucide-preact";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";

interface AddProjectModalProps {
    onClose: () => void;
    onAdd: (project: { name: string; type: 'local' | 'git'; path: string; cloneDir?: string }) => void;
}

type SourceType = 'local' | 'git';

export const AddProjectModal: FunctionComponent<AddProjectModalProps> = ({ onClose, onAdd }) => {
    const cardRef     = useRef<HTMLDivElement>(null);
    const fieldsRef   = useRef<HTMLDivElement>(null);

    const [name, setName]           = useState('');
    const [sourceType, setSourceType] = useState<SourceType>('local');
    const [localPath, setLocalPath] = useState('');
    const [gitUrl, setGitUrl]       = useState('');
    const [cloneDir, setCloneDir]   = useState('');
    const [error, setError]         = useState<string | null>(null);

    const reducedMotion = useReducedMotion();
    const isSubmitting = useRef(false);

    useLayoutEffect(() => {
        const d_backdrop = reducedMotion ? 0 : MODAL_MOTION.entry.duration;
        const d_card = reducedMotion ? 0 : MODAL_MOTION.entry.duration;
        const d_fields = reducedMotion ? 0 : 0.45;

        gsap.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: d_backdrop, ease: MODAL_MOTION.backdrop.ease });
        gsap.fromTo(cardRef.current,
            { y: reducedMotion ? 0 : MODAL_MOTION.entry.yStart, opacity: MODAL_MOTION.entry.opacityStart, scale: reducedMotion ? 1 : MODAL_MOTION.entry.scaleStart, filter: reducedMotion ? MODAL_MOTION.entry.filterEnd : MODAL_MOTION.entry.filterStart },
            { y: MODAL_MOTION.entry.yEnd, opacity: MODAL_MOTION.entry.opacityEnd, scale: MODAL_MOTION.entry.scaleEnd, filter: MODAL_MOTION.entry.filterEnd, duration: d_card, ease: MODAL_MOTION.entry.ease }
        );
        if (fieldsRef.current) {
            gsap.fromTo(Array.from(fieldsRef.current.children),
                { y: reducedMotion ? 0 : 18, opacity: 0 },
                { y: 0, opacity: 1, stagger: reducedMotion ? 0 : 0.07, duration: d_fields, ease: "power3.out", delay: reducedMotion ? 0 : 0.25 }
            );
        }
    }, [reducedMotion]);

    const handleClose = () => {
        if (isSubmitting.current) return;

        const duration = reducedMotion ? 0 : MODAL_MOTION.exit.duration;
        gsap.to(cardRef.current, { y: MODAL_MOTION.exit.yEnd, opacity: MODAL_MOTION.exit.opacityEnd, scale: MODAL_MOTION.exit.scaleEnd, filter: MODAL_MOTION.exit.filterEnd, duration, ease: MODAL_MOTION.exit.ease });
        gsap.to(backdropRef.current, { opacity: 0, duration, delay: reducedMotion ? 0 : 0.05, onComplete: onClose });
    };

    const backdropRef = useFocusTrap(true, { onClose: handleClose, restoreFocus: true });

    const handleBackdropClick = (e: PointerEvent) => {
        if (e.target === backdropRef.current) handleClose();
    };

    const handleSubmit = (e: Event) => {
        e.preventDefault();
        isSubmitting.current = true;
        const path = sourceType === 'local' ? localPath.trim() : gitUrl.trim();

        if (!name.trim()) {
            setError("Project Name is required.");
            isSubmitting.current = false;
            return;
        }

        if (!path) {
            setError(sourceType === 'local' ? "Directory Path is required." : "Repository URL is required.");
            isSubmitting.current = false;
            return;
        }

        setError(null);
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
            onPointerDown={handleBackdropClick}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-project-modal-title"
            className="fixed inset-0 z-[200] flex items-center justify-center px-6 bg-void-900/40 dark:bg-void-950/60 backdrop-blur-3xl"
        >
            <div
                ref={cardRef}
                className="relative w-full max-w-2xl overflow-hidden rounded-3xl shadow-[0_64px_128px_rgba(0,0,0,0.3)] dark:shadow-[0_64px_128px_rgba(0,0,0,0.8)] flex border border-white/[0.05] dark:border-white/[0.08]"
                style={{ minHeight: '520px' }}
            >
                {/* ── Left decorative panel ── */}
                <div className="relative w-52 shrink-0 bg-void-900 dark:bg-void-950 flex flex-col justify-between p-8 overflow-hidden border-r border-white/[0.05] dark:border-white/[0.08]">
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
                <div className="flex-1 bg-white/98 dark:bg-void-800/98 p-8 flex flex-col backdrop-blur-3xl">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-8">
                        <div>
                            <h2 id="add-project-modal-title" className="text-[2rem] font-black text-slate-900 dark:text-white tracking-tight font-display leading-none">
                                Add Project.
                            </h2>
                            <p className="text-[11px] font-bold text-slate-400 dark:text-void-500 mt-2.5 tracking-wide uppercase">
                                Connect a local directory or remote repository
                            </p>
                        </div>
                        <button
                            onClick={handleClose}
                            aria-label="Close"
                            className="w-10 h-10 flex items-center justify-center rounded-2xl bg-black/[0.04] dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/10 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all active:scale-95 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500"
                        >
                            <X className="w-4.5 h-4.5" />
                        </button>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="flex flex-col flex-1">
                        <div ref={fieldsRef} className="flex flex-col gap-7 flex-1">

                            {error && (
                                <div role="alert" aria-live="assertive" id="project-form-error" className="text-status-red text-xs font-black uppercase tracking-widest bg-status-red/5 px-4 py-3 rounded-xl border border-status-red/20">
                                    {error}
                                </div>
                            )}

                            {/* Project Name */}
                            <div className="group/field">
                                <label htmlFor="add-project-name" className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 group-focus-within/field:text-ember-500 transition-colors">
                                    Project Name
                                </label>
                                <input
                                    id="add-project-name"
                                    type="text"
                                    value={name}
                                    onInput={(e) => {
                                        setName((e.target as HTMLInputElement).value);
                                        if (error) setError(null);
                                    }}
                                    placeholder="My Awesome Project"
                                    className="mt-2 w-full bg-transparent border-0 border-b-2 border-black/[0.06] dark:border-white/[0.06] focus:border-ember-500 dark:focus:border-ember-500 pb-2 text-[1.6rem] font-black text-slate-900 dark:text-white placeholder-slate-200 dark:placeholder-void-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 transition-colors font-display tracking-tight leading-none"
                                    required
                                    autoFocus
                                    aria-invalid={!!error && !name.trim()}
                                    aria-describedby={error && !name.trim() ? "project-form-error" : undefined}
                                />
                            </div>

                            {/* Source Type Toggle */}
                            <fieldset>
                                <legend className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 block mb-3">
                                    Source Type
                                </legend>
                                <div className="inline-flex p-1 bg-black/[0.03] dark:bg-white/[0.03] rounded-2xl gap-1 border border-black/[0.03] dark:border-white/[0.03]">
                                    {(['local', 'git'] as SourceType[]).map((type) => (
                                        <button
                                            key={type}
                                            type="button"
                                            onClick={() => handleSourceTypeChange(type)}
                                            className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.18em] transition-all active:scale-95 duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 ${
                                                sourceType === type
                                                    ? 'bg-ember-500 text-void-900 shadow-[0_4px_16px_rgba(255,184,0,0.35)]'
                                                    : 'text-slate-500 dark:text-void-500 hover:text-slate-800 dark:hover:text-void-200'
                                            }`}
                                        >
                                            {type === 'local'
                                                ? <FolderInput className="w-3.5 h-3.5" strokeWidth={2.5} />
                                                : <GitBranch className="w-3.5 h-3.5" strokeWidth={2.5} />
                                            }
                                            {type === 'local' ? 'Local Path' : 'Git URL'}
                                        </button>
                                    ))}
                                </div>
                            </fieldset>

                            {/* Conditional fields */}
                            {sourceType === 'local' ? (
                                <div className="group/field">
                                    <label htmlFor="add-project-path" className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 group-focus-within/field:text-ember-500 transition-colors flex items-center gap-2">
                                        <FolderInput className="w-3.5 h-3.5" strokeWidth={2.5} /> Directory Path
                                    </label>
                                    <input
                                        id="add-project-path"
                                        type="text"
                                        value={localPath}
                                        onInput={(e) => {
                                            setLocalPath((e.target as HTMLInputElement).value);
                                            if (error) setError(null);
                                        }}
                                        placeholder="/home/user/projects/my-project"
                                        className="mt-2 w-full bg-transparent border-0 border-b-2 border-black/[0.06] dark:border-white/[0.06] focus:border-ember-500 dark:focus:border-ember-500 pb-2 text-[13px] font-mono font-bold text-slate-700 dark:text-void-300 placeholder-slate-300 dark:placeholder-void-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 transition-colors"
                                        required
                                        aria-invalid={!!error && !localPath.trim()}
                                        aria-describedby={error && !localPath.trim() ? "project-form-error" : undefined}
                                    />
                                </div>
                            ) : (
                                <>
                                    <div className="group/field">
                                        <label htmlFor="add-project-git-url" className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 group-focus-within/field:text-ember-500 transition-colors flex items-center gap-2">
                                            <Link2 className="w-3.5 h-3.5" strokeWidth={2.5} /> Repository URL
                                        </label>
                                        <input
                                            id="add-project-git-url"
                                            type="text"
                                            value={gitUrl}
                                            onInput={(e) => {
                                                setGitUrl((e.target as HTMLInputElement).value);
                                                if (error) setError(null);
                                            }}
                                            placeholder="https://github.com/user/repo.git"
                                            className="mt-2 w-full bg-transparent border-0 border-b-2 border-black/[0.06] dark:border-white/[0.06] focus:border-ember-500 dark:focus:border-ember-500 pb-2 text-[13px] font-mono font-bold text-slate-700 dark:text-void-300 placeholder-slate-300 dark:placeholder-void-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 transition-colors"
                                            required
                                            aria-invalid={!!error && !gitUrl.trim()}
                                            aria-describedby={error && !gitUrl.trim() ? "project-form-error" : undefined}
                                        />
                                    </div>
                                    <div className="group/field">
                                        <label htmlFor="add-project-clone-dir" className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 group-focus-within/field:text-ember-500 transition-colors flex items-center gap-2">
                                            <FolderInput className="w-3.5 h-3.5" strokeWidth={2.5} /> Clone Into Directory
                                            <span className="ml-1.5 text-slate-300 dark:text-void-600 normal-case font-bold tracking-normal">(optional)</span>
                                        </label>
                                        <input
                                            id="add-project-clone-dir"
                                            type="text"
                                            value={cloneDir}
                                            onInput={(e) => setCloneDir((e.target as HTMLInputElement).value)}
                                            placeholder="/home/user/projects"
                                            className="mt-2 w-full bg-transparent border-0 border-b-2 border-black/[0.06] dark:border-white/[0.06] focus:border-ember-500 dark:focus:border-ember-500 pb-2 text-[13px] font-mono font-bold text-slate-700 dark:text-void-300 placeholder-slate-300 dark:placeholder-void-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 transition-colors"
                                        />
                                    </div>
                                </>
                            )}

                            {/* Spacer */}
                            <div className="flex-1" />

                            {/* Actions */}
                            <div className="flex items-center justify-between pt-2">
                                <button
                                    type="button"
                                    onClick={handleClose}
                                    className="text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 rounded-lg px-2 py-1"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="group/btn flex items-center gap-3 px-8 py-4 bg-ember-500 hover:bg-ember-400 text-void-900 font-black uppercase tracking-widest text-[11px] rounded-2xl transition-all duration-300 shadow-[0_8px_32px_rgba(255,184,0,0.3)] hover:shadow-[0_12px_48px_rgba(255,184,0,0.5)] active:scale-95 hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500"
                                >
                                    <Plus className="w-4 h-4 group-hover/btn:rotate-90 transition-transform duration-500" strokeWidth={3} />
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
