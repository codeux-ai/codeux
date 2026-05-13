import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState, useMemo } from "preact/hooks";
import gsap from "gsap";
import { AlertCircle, Check, ChevronUp, FolderOpen, GitBranch, FolderInput, Home, Link2, Loader2, Plus, RefreshCw, X } from "lucide-preact";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";
import { fetchLocalDirectories } from "../../lib/project-api.js";
import type { LocalDirectoryBrowserResponse } from "../../types.js";

interface AddProjectModalProps {
    onClose: () => void;
    onAdd: (project: { name: string; type: 'local' | 'git'; path: string; cloneDir?: string }) => void;
}

type SourceType = 'local' | 'git';
type DirectoryPickerTarget = 'localPath' | 'cloneDir';

const fieldLabelClass = "text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 group-focus-within/field:text-ember-600 dark:group-focus-within/field:text-ember-400 transition-colors";

const projectNameInputClass = "mt-2.5 w-full rounded-[1.35rem] border border-black/[0.06] bg-black/[0.025] px-4 py-3.5 font-display text-[1.55rem] font-black leading-none tracking-tight text-slate-900 outline-none transition-all duration-250 placeholder:text-slate-200 focus:border-ember-500/45 focus:bg-white focus:shadow-[0_0_0_1px_rgba(255,184,0,0.18),0_14px_34px_rgba(255,184,0,0.12)] focus-visible:outline-none dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-white dark:placeholder:text-slate-700 dark:focus:border-ember-500/50 dark:focus:bg-white/[0.055] dark:focus:shadow-[0_0_0_1px_rgba(255,184,0,0.22),0_16px_38px_rgba(255,184,0,0.1)] aria-[invalid=true]:border-status-red/60 aria-[invalid=true]:shadow-[0_0_0_1px_rgba(211,47,47,0.14)]";

const detailInputSurfaceClass = "w-full rounded-[1.15rem] border border-black/[0.06] bg-black/[0.025] px-4 py-3 text-sm font-mono font-semibold text-slate-700 outline-none transition-all duration-250 placeholder:text-slate-300 focus:border-ember-500/45 focus:bg-white focus:shadow-[0_0_0_1px_rgba(255,184,0,0.16),0_12px_28px_rgba(255,184,0,0.1)] focus-visible:outline-none dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-300 dark:placeholder:text-slate-600 dark:focus:border-ember-500/50 dark:focus:bg-white/[0.055] aria-[invalid=true]:border-status-red/60 aria-[invalid=true]:shadow-[0_0_0_1px_rgba(211,47,47,0.14)]";
const detailInputClass = `mt-2.5 ${detailInputSurfaceClass}`;
const modalMinHeight = "min(640px, calc(100vh - 2rem))";

export const AddProjectModal: FunctionComponent<AddProjectModalProps> = ({ onClose, onAdd }) => {
    const cardRef     = useRef<HTMLDivElement>(null);
    const fieldsRef   = useRef<HTMLDivElement>(null);

    const [name, setName]           = useState('');
    const [sourceType, setSourceType] = useState<SourceType>('local');
    const [localPath, setLocalPath] = useState('');
    const [gitUrl, setGitUrl]       = useState('');
    const [cloneDir, setCloneDir]   = useState('');
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [activeDirectoryPickerTarget, setActiveDirectoryPickerTarget] = useState<DirectoryPickerTarget | null>(null);
    const [directoryListing, setDirectoryListing] = useState<LocalDirectoryBrowserResponse | null>(null);
    const [directoryPickerError, setDirectoryPickerError] = useState<string | null>(null);
    const [isDirectoryPickerLoading, setIsDirectoryPickerLoading] = useState(false);

    const reducedMotion = useReducedMotion();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isClosing, setIsClosing] = useState(false);
    const [touched, setTouched] = useState({ name: false, path: false });

    const validationErrors = useMemo(() => {
        const errors: Record<string, string> = {};
        if (!name.trim()) errors.name = "Project Name is required.";

        const path = sourceType === 'local' ? localPath.trim() : gitUrl.trim();
        if (!path) {
            errors.path = sourceType === 'local' ? "Directory Path is required." : "Repository URL is required.";
        }
        return errors;
    }, [name, localPath, gitUrl, sourceType]);

    useLayoutEffect(() => {
        const d_backdrop = reducedMotion ? 0 : MODAL_MOTION.backdrop.duration;
        const d_card = reducedMotion ? 0 : MODAL_MOTION.entry.duration;
        const d_fields = reducedMotion ? 0 : 0.45;

        gsap.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: d_backdrop, ease: MODAL_MOTION.backdrop.ease });
        gsap.fromTo(cardRef.current,
            { y: reducedMotion ? 0 : MODAL_MOTION.entry.yStart, opacity: MODAL_MOTION.entry.opacityStart, scale: reducedMotion ? 1 : MODAL_MOTION.entry.scaleStart, filter: reducedMotion ? MODAL_MOTION.entry.filterEnd : MODAL_MOTION.entry.filterStart },
            { y: MODAL_MOTION.entry.yEnd, opacity: MODAL_MOTION.entry.opacityEnd, scale: MODAL_MOTION.entry.scaleEnd, filter: MODAL_MOTION.entry.filterEnd, duration: d_card, ease: MODAL_MOTION.entry.ease, clearProps: "filter" }
        );
        if (fieldsRef.current) {
            gsap.fromTo(Array.from(fieldsRef.current.children),
                { y: reducedMotion ? 0 : 18, opacity: 0 },
                { y: 0, opacity: 1, stagger: reducedMotion ? 0 : 0.07, duration: d_fields, ease: "power3.out", delay: reducedMotion ? 0 : 0.25 }
            );
        }
    }, [reducedMotion]);

    const handleClose = () => {
        if (isSubmitting) return;
        setIsClosing(true);

        const d_card = reducedMotion ? 0 : MODAL_MOTION.exit.duration;
        const d_backdrop = reducedMotion ? 0 : MODAL_MOTION.backdrop.duration;

        gsap.to(cardRef.current, { y: MODAL_MOTION.exit.yEnd, opacity: MODAL_MOTION.exit.opacityEnd, scale: MODAL_MOTION.exit.scaleEnd, filter: MODAL_MOTION.exit.filterEnd, duration: d_card, ease: MODAL_MOTION.exit.ease });
        gsap.to(backdropRef.current, { opacity: 0, duration: d_backdrop, delay: reducedMotion ? 0 : 0.05, onComplete: onClose });
    };

    const backdropRef = useFocusTrap(!isClosing, { onClose: handleClose, restoreFocus: true });

    const handleBackdropClick = (e: PointerEvent) => {
        if (e.target === backdropRef.current) handleClose();
    };

    const handleSubmit = async (e: Event) => {
        e.preventDefault();

        if (Object.keys(validationErrors).length > 0) {
            setTouched({ name: true, path: true });
            return;
        }

        const path = sourceType === 'local' ? localPath.trim() : gitUrl.trim();

        setIsSubmitting(true);
        setSubmitError(null);
        try {
            await Promise.resolve(onAdd({
                name: name.trim(),
                type: sourceType,
                path,
                ...(sourceType === 'git' && cloneDir.trim() ? { cloneDir: cloneDir.trim() } : {}),
            }));
            handleClose();
        } catch (err) {
            setIsSubmitting(false);
            setSubmitError(err instanceof Error ? err.message : String(err));
        }
    };

    const loadDirectory = async (target: DirectoryPickerTarget, directoryPath?: string) => {
        setActiveDirectoryPickerTarget(target);
        setIsDirectoryPickerLoading(true);
        setDirectoryPickerError(null);
        try {
            const listing = await fetchLocalDirectories(directoryPath);
            setDirectoryListing(listing);
        } catch (err) {
            setDirectoryPickerError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsDirectoryPickerLoading(false);
        }
    };

    const handleOpenDirectoryPicker = (target: DirectoryPickerTarget) => {
        const initialPath = target === 'localPath' ? localPath.trim() : cloneDir.trim();
        void loadDirectory(target, initialPath || undefined);
    };

    const handleUseDirectory = () => {
        if (!directoryListing) return;
        if (activeDirectoryPickerTarget === 'localPath') {
            setLocalPath(directoryListing.currentPath);
            setTouched(prev => ({ ...prev, path: false }));
        } else if (activeDirectoryPickerTarget === 'cloneDir') {
            setCloneDir(directoryListing.currentPath);
        }
        setSubmitError(null);
        setActiveDirectoryPickerTarget(null);
    };

    // Re-animate fields when source type changes
    const handleSourceTypeChange = (type: SourceType) => {
        setSourceType(type);
        setActiveDirectoryPickerTarget(null);
        if (fieldsRef.current) {
            const conditionalFields = Array.from(fieldsRef.current.children).slice(2);
            gsap.fromTo(conditionalFields,
                { y: 12, opacity: 0 },
                { y: 0, opacity: 1, stagger: 0.06, duration: 0.35, ease: "power3.out" }
            );
        }
    };

    const renderDirectoryPicker = (target: DirectoryPickerTarget) => {
        if (activeDirectoryPickerTarget !== target) return null;
        const pickerId = target === 'localPath' ? "add-project-directory-picker" : "add-project-clone-directory-picker";

        return (
            <div
                id={pickerId}
                className="mt-3 overflow-hidden rounded-[1.15rem] border border-black/[0.06] bg-black/[0.025] dark:border-white/[0.08] dark:bg-white/[0.035]"
            >
                <div className="flex items-center gap-2 border-b border-black/[0.06] px-3 py-2.5 dark:border-white/[0.08]">
                    <button
                        type="button"
                        onClick={() => directoryListing?.parentPath && void loadDirectory(target, directoryListing.parentPath)}
                        disabled={!directoryListing?.parentPath || isDirectoryPickerLoading}
                        className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm transition-all hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:text-white"
                        aria-label="Go to parent directory"
                        title="Go up"
                    >
                        <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => void loadDirectory(target, directoryListing?.homePath)}
                        disabled={isDirectoryPickerLoading}
                        className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm transition-all hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:text-white"
                        aria-label="Go to home directory"
                        title="Home"
                    >
                        <Home className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            const typedPath = target === 'localPath' ? localPath.trim() : cloneDir.trim();
                            void loadDirectory(target, directoryListing?.currentPath || typedPath || undefined);
                        }}
                        disabled={isDirectoryPickerLoading}
                        className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm transition-all hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:text-white"
                        aria-label="Refresh directories"
                        title="Refresh"
                    >
                        <RefreshCw className={`h-4 w-4 ${isDirectoryPickerLoading ? "animate-spin" : ""}`} />
                    </button>
                    <div className="min-w-0 flex-1 truncate rounded-xl bg-white px-3 py-2 font-mono text-xs font-semibold text-slate-600 dark:bg-white/[0.055] dark:text-slate-300">
                        {directoryListing?.currentPath || "Loading directories..."}
                    </div>
                    <button
                        type="button"
                        onClick={handleUseDirectory}
                        disabled={!directoryListing || isDirectoryPickerLoading}
                        className="flex h-8 items-center gap-1.5 rounded-xl bg-ember-500 px-3 text-xs font-black uppercase tracking-[0.12em] text-void-900 transition-all hover:bg-ember-400 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                    >
                        <Check className="h-3.5 w-3.5" />
                        Use
                    </button>
                </div>
                {directoryPickerError ? (
                    <div className="flex items-center gap-2 px-3 py-3 text-xs font-semibold text-status-red">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <span>{directoryPickerError}</span>
                    </div>
                ) : (
                    <div className="max-h-44 overflow-y-auto p-2">
                        {isDirectoryPickerLoading && !directoryListing ? (
                            <div className="flex items-center gap-2 px-2 py-3 text-xs font-semibold text-slate-400">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading directories
                            </div>
                        ) : directoryListing?.directories.length ? (
                            <div className="grid gap-1">
                                {directoryListing.directories.map((directory) => (
                                    <button
                                        key={directory.path}
                                        type="button"
                                        onClick={() => void loadDirectory(target, directory.path)}
                                        className="flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 text-left font-mono text-xs font-semibold text-slate-600 transition-all hover:bg-white hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white"
                                    >
                                        <FolderOpen className="h-4 w-4 shrink-0 text-ember-500" />
                                        <span className="truncate">{directory.name}</span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="px-2 py-3 text-xs font-semibold text-slate-400">
                                No child directories
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div
            ref={backdropRef}
            onPointerDown={handleBackdropClick}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-project-modal-title"
            className="fixed inset-0 z-[200] flex items-center justify-center px-6 bg-black/50 dark:bg-black/70 backdrop-blur-xl"
        >
            <div
                ref={cardRef}
                className="relative flex w-full max-w-2xl lg:max-w-3xl max-h-[calc(100vh-2rem)] overflow-hidden rounded-[2.5rem] shadow-[0_48px_96px_rgba(0,0,0,0.25)] dark:shadow-[0_48px_96px_rgba(0,0,0,0.7)]"
                style={{ minHeight: modalMinHeight }}
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
                <div className="flex-1 overflow-y-auto bg-white/98 dark:bg-void-800/98 p-7 lg:p-8 flex flex-col">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-6 lg:mb-8">
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
                            className="w-9 h-9 flex items-center justify-center rounded-full bg-black/[0.05] dark:bg-white/[0.05] hover:bg-black/10 dark:hover:bg-white/10 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all active:scale-95 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="flex flex-col flex-1">
                        <div ref={fieldsRef} className="flex flex-col gap-5 lg:gap-6 flex-1">

                            {submitError && (
                                // form errors demand immediate user attention to proceed.
                                <div role="alert" aria-live="assertive" id="project-form-error" className="text-status-red text-sm font-medium">
                                    {submitError}
                                </div>
                            )}

                            {/* Project Name */}
                            <div className="group/field">
                                <label htmlFor="add-project-name" className={fieldLabelClass}>
                                    Project Name
                                </label>
                                <input
                                    id="add-project-name"
                                    type="text"
                                    value={name}
                                    onInput={(e) => {
                                        setName((e.target as HTMLInputElement).value);
                                        if (submitError) setSubmitError(null);
                                    }}
                                    placeholder="My Awesome Project"
                                    className={projectNameInputClass}
                                    required
                                    autoFocus
                                    aria-invalid={!!validationErrors.name && touched.name}
                                    aria-describedby={validationErrors.name && touched.name ? "project-name-error" : undefined}
                                    onBlur={() => setTouched(prev => ({ ...prev, name: true }))}
                                />
                                {validationErrors.name && touched.name && <div id="project-name-error" className="text-xs text-red-500 mt-1 font-medium">{validationErrors.name}</div>}
                            </div>

                            {/* Source Type Toggle */}
                            <fieldset>
                                <legend className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 block mb-2.5">
                                    Source Type
                                </legend>
                                <div className="inline-flex p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-2xl gap-1">
                                    {(['local', 'git'] as SourceType[]).map((type) => (
                                        <button
                                            key={type}
                                            type="button"
                                            onClick={() => handleSourceTypeChange(type)}
                                            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-[0.14em] transition-all active:scale-95 duration-250 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 ${
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
                            </fieldset>

                            {/* Conditional fields */}
                            {sourceType === 'local' ? (
                                <div className="group/field">
                                    <label htmlFor="add-project-path" className={`${fieldLabelClass} flex items-center gap-1.5`}>
                                        <FolderInput className="w-3 h-3" /> Directory Path
                                    </label>
                                    <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-stretch">
                                        <input
                                            id="add-project-path"
                                            type="text"
                                            value={localPath}
                                            onInput={(e) => {
                                                setLocalPath((e.target as HTMLInputElement).value);
                                                if (submitError) setSubmitError(null);
                                            }}
                                            placeholder="/home/user/projects/my-project"
                                            className={`${detailInputSurfaceClass} min-w-0 flex-1`}
                                            required
                                            aria-invalid={!!validationErrors.path && touched.path}
                                            aria-describedby={validationErrors.path && touched.path ? "project-path-error" : undefined}
                                            onBlur={() => setTouched(prev => ({ ...prev, path: true }))}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleOpenDirectoryPicker('localPath')}
                                            className="flex shrink-0 items-center justify-center gap-2 rounded-[1.15rem] border border-black/[0.06] bg-void-900 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white transition-all duration-250 hover:-translate-y-px hover:bg-void-800 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 dark:border-white/[0.08] dark:bg-white/[0.08] dark:text-white dark:hover:bg-white/[0.12]"
                                            aria-expanded={activeDirectoryPickerTarget === 'localPath'}
                                            aria-controls="add-project-directory-picker"
                                            title="Browse directories"
                                        >
                                            <FolderOpen className="h-4 w-4" />
                                            Browse
                                        </button>
                                    </div>
                                    {renderDirectoryPicker('localPath')}
                                    {validationErrors.path && touched.path && <div id="project-path-error" className="text-xs text-red-500 mt-1 font-medium">{validationErrors.path}</div>}
                                </div>
                            ) : (
                                <>
                                    <div className="group/field">
                                        <label htmlFor="add-project-git-url" className={`${fieldLabelClass} flex items-center gap-1.5`}>
                                            <Link2 className="w-3 h-3" /> Repository URL
                                        </label>
                                        <input
                                            id="add-project-git-url"
                                            type="text"
                                            value={gitUrl}
                                            onInput={(e) => {
                                                setGitUrl((e.target as HTMLInputElement).value);
                                                if (submitError) setSubmitError(null);
                                            }}
                                            placeholder="https://github.com/user/repo.git"
                                            className={detailInputClass}
                                            required
                                            aria-invalid={!!validationErrors.path && touched.path}
                                            aria-describedby={validationErrors.path && touched.path ? "project-git-error" : undefined}
                                            onBlur={() => setTouched(prev => ({ ...prev, path: true }))}
                                        />
                                        {validationErrors.path && touched.path && <div id="project-git-error" className="text-xs text-red-500 mt-1 font-medium">{validationErrors.path}</div>}
                                    </div>
                                    <div className="group/field">
                                        <label htmlFor="add-project-clone-dir" className={`${fieldLabelClass} flex items-center gap-1.5`}>
                                            <FolderInput className="w-3 h-3" /> Clone Into Directory
                                            <span className="ml-1 text-slate-300 dark:text-slate-600 normal-case font-medium tracking-normal">(optional)</span>
                                        </label>
                                        <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-stretch">
                                            <input
                                                id="add-project-clone-dir"
                                                type="text"
                                                value={cloneDir}
                                                onInput={(e) => setCloneDir((e.target as HTMLInputElement).value)}
                                                placeholder="/home/user/projects"
                                                className={`${detailInputSurfaceClass} min-w-0 flex-1`}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => handleOpenDirectoryPicker('cloneDir')}
                                                className="flex shrink-0 items-center justify-center gap-2 rounded-[1.15rem] border border-black/[0.06] bg-void-900 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white transition-all duration-250 hover:-translate-y-px hover:bg-void-800 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 dark:border-white/[0.08] dark:bg-white/[0.08] dark:text-white dark:hover:bg-white/[0.12]"
                                                aria-expanded={activeDirectoryPickerTarget === 'cloneDir'}
                                                aria-controls="add-project-clone-directory-picker"
                                                title="Browse clone directory"
                                            >
                                                <FolderOpen className="h-4 w-4" />
                                                Browse
                                            </button>
                                        </div>
                                        {renderDirectoryPicker('cloneDir')}
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
                                    className="text-sm font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 rounded"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="group/btn flex items-center gap-2.5 px-6 py-3 bg-ember-500 hover:bg-ember-400 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400 text-void-900 font-bold text-sm rounded-2xl transition-all duration-300 shadow-[0_4px_20px_rgba(255,184,0,0.25)] hover:shadow-[0_8px_32px_rgba(255,184,0,0.4)] disabled:shadow-none active:scale-95 disabled:active:scale-100 hover:-translate-y-px disabled:hover:-translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500"
                                >
                                    {isSubmitting ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Plus className="w-4 h-4 group-hover/btn:rotate-90 transition-transform duration-300" />
                                    )}
                                    {isSubmitting ? "Adding..." : "Add Project"}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};
