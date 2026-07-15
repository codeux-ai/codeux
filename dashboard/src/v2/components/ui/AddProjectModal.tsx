import type { FunctionComponent } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { AlertCircle, BookOpen, Bot, Check, ChevronUp, Cloud, FolderOpen, GitBranch, FolderInput, Globe, Home, Info, Layers3, Link2, Loader2, Lock, PlaySquare, Plus, RefreshCw, ShieldCheck, Sparkles, Workflow, X } from "lucide-preact";
import { FormError } from "../forms/FormError.js";
import { Modal } from "./Modal.js";
import { ActionFeedbackRegion } from "./ActionFeedbackRegion.js";
import { fetchLocalDirectories } from "../../lib/project-api.js";
import type { LocalDirectoryBrowserResponse, ProjectSetupOptions } from "../../types.js";
import type { ApplicationKind } from "../../../types.js";
import { BUILTIN_CODE_UX_TECHSTACK_ID } from "../../../../../src/domain/settings/project-creation-defaults.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { useDashboardI18n } from "../../i18n/context.js";
import { projectMessages } from "../../i18n/messages/projects.js";

export type SourceType = 'local' | 'git' | 'new_project';

type ExistingProjectSubmission = {
    name: string;
    type: 'local' | 'git';
    path: string;
    cloneDir?: string;
    setup?: {
        enabled: boolean;
        options: ProjectSetupOptions;
    };
};

type NewProjectSubmission = {
    name: string;
    type: 'new_project';
    path: string;
    initMode: 'new-local' | 'new-remote';
    applicationKind?: ApplicationKind | null;
    selectedTechstackId?: string | null;
    remoteProvider?: 'github' | 'gitlab';
    isPrivate?: boolean;
    repoSlug?: string;
};

export type AddProjectModalSubmission = ExistingProjectSubmission | NewProjectSubmission;

const slugify = (text: string): string => {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');
};

interface AddProjectModalProps {
    onClose: () => void;
    onAdd: (project: AddProjectModalSubmission) => void | Promise<void>;
    initialSourceType?: SourceType;
    quickActionDefaults?: {
        applicationKind: ApplicationKind;
        selectedTechstackId: string;
    };
}

type DirectoryPickerTarget = 'localPath' | 'cloneDir';

const fieldLabelClass = "text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 group-focus-within/field:text-ember-600 dark:group-focus-within/field:text-ember-400 transition-colors";

const projectNameInputClass = "mt-2.5 w-full rounded-[1.35rem] border border-black/[0.06] bg-black/[0.025] px-4 py-3.5 font-display text-xl font-semibold leading-none tracking-tight text-slate-900 outline-none transition-all duration-250 placeholder:text-slate-200 focus:border-ember-500/45 focus:bg-white focus:shadow-[0_0_0_1px_rgba(255,184,0,0.18),0_14px_34px_rgba(255,184,0,0.12)] focus-visible:outline-none dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-white dark:placeholder:text-slate-700 dark:focus:border-ember-500/50 dark:focus:bg-white/[0.055] dark:focus:shadow-[0_0_0_1px_rgba(255,184,0,0.22),0_16px_38px_rgba(255,184,0,0.1)] aria-[invalid=true]:border-status-red/60 aria-[invalid=true]:shadow-[0_0_0_1px_rgba(211,47,47,0.14)]";

const detailInputSurfaceClass = "w-full rounded-[1.15rem] border border-black/[0.06] bg-black/[0.025] px-4 py-3 text-sm font-mono font-semibold text-slate-700 outline-none transition-all duration-250 placeholder:text-slate-300 focus:border-ember-500/45 focus:bg-white focus:shadow-[0_0_0_1px_rgba(255,184,0,0.16),0_12px_28px_rgba(255,184,0,0.1)] focus-visible:outline-none dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-300 dark:placeholder:text-slate-600 dark:focus:border-ember-500/50 dark:focus:bg-white/[0.055] aria-[invalid=true]:border-status-red/60 aria-[invalid=true]:shadow-[0_0_0_1px_rgba(211,47,47,0.14)]";
const detailInputClass = `mt-2.5 ${detailInputSurfaceClass}`;
const modalMinHeight = "min(640px, calc(100dvh - 2rem))";

function focusFirstInvalidField(formId: string, scrollContainerId: string, reducedMotion: boolean): void {
    const firstInvalid = document.getElementById(formId)?.querySelector('[aria-invalid="true"]');
    if (!(firstInvalid instanceof HTMLElement)) return;

    firstInvalid.focus({ preventScroll: true });
    const container = document.getElementById(scrollContainerId);
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const elementRect = firstInvalid.getBoundingClientRect();
    const targetTop = elementRect.top - containerRect.top + container.scrollTop - 20;
    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTo({ top: Math.min(Math.max(targetTop, 0), maxTop), behavior: reducedMotion ? 'auto' : 'smooth' });
}

export const AddProjectModal: FunctionComponent<AddProjectModalProps> = ({ onClose, onAdd, initialSourceType, quickActionDefaults }) => {
    const { translate, translatePlural } = useDashboardI18n();
    const fieldsRef   = useRef<HTMLFormElement>(null);
    const transitionSurfaceRef = useRef<HTMLDivElement>(null);
    const previousTransitionKeyRef = useRef<string | null>(null);
    const reducedMotion = useReducedMotion();
    const motionTokens = useGsapInteractionTokens();
    const cssTokens = useInteractionTokens();

    const [name, setName]           = useState('');
    const [gitUrlSlug, setGitUrlSlug] = useState('');
    const [isSlugEdited, setIsSlugEdited] = useState(false);
    const [sourceType, setSourceType] = useState<SourceType>(initialSourceType ?? 'local');
    const [localPath, setLocalPath] = useState('');
    const [gitUrl, setGitUrl]       = useState('');
    const [cloneDir, setCloneDir]   = useState('');
    const [newInitMode, setNewInitMode] = useState<'new-local' | 'new-remote'>('new-local');
    const [newProvider, setNewProvider] = useState<'github' | 'gitlab'>('github');
    const [newIsPrivate, setNewIsPrivate] = useState(true);
    const [initializeProject, setInitializeProject] = useState(true);
    const [showSetupOptions, setShowSetupOptions] = useState(false);
    const [setupOptions, setSetupOptions] = useState<ProjectSetupOptions>({
        agents: true,
        quicksprints: true,
        previewScript: false,
        ci: true,
        techstack: true,
        docs: false,
    });
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [validationSummary, setValidationSummary] = useState<string | null>(null);
    const [activeDirectoryPickerTarget, setActiveDirectoryPickerTarget] = useState<DirectoryPickerTarget | null>(null);
    const [directoryListing, setDirectoryListing] = useState<LocalDirectoryBrowserResponse | null>(null);
    const [directoryPickerError, setDirectoryPickerError] = useState<string | null>(null);
    const [isDirectoryPickerLoading, setIsDirectoryPickerLoading] = useState(false);
    const [pendingDirectoryPath, setPendingDirectoryPath] = useState<string | null>(null);
    const [directorySelectionMessage, setDirectorySelectionMessage] = useState<string | null>(null);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const [touched, setTouched] = useState({ name: false, path: false, slug: false });
    const newProjectTechstackId = quickActionDefaults?.selectedTechstackId
        ?? BUILTIN_CODE_UX_TECHSTACK_ID;
    const newProjectApplicationKind = quickActionDefaults?.applicationKind ?? null;
    const quickActionContextLabel = quickActionDefaults?.applicationKind === 'web'
        ? translate(projectMessages, "webApp")
        : quickActionDefaults?.applicationKind === 'desktop'
            ? translate(projectMessages, "desktopApp")
            : null;

    const validationErrors = useMemo(() => {
        const errors: Record<string, string> = {};
        if (!name.trim()) errors.name = translate(projectMessages, "projectNameRequired");

        if (sourceType === 'git' && !gitUrl.trim()) {
            errors.path = translate(projectMessages, "repositoryUrlRequired");
        }
        if (sourceType === 'new_project' && newInitMode === 'new-remote' && !gitUrlSlug.trim()) {
            errors.slug = translate(projectMessages, "gitUrlSlugRequired");
        }
        return errors;
    }, [gitUrl, gitUrlSlug, localPath, name, newInitMode, sourceType, translate]);

    const sourceTransitionKey = `${sourceType}:${newInitMode}:${showSetupOptions ? 'setup' : 'details'}`;

    useLayoutEffect(() => {
        const surface = transitionSurfaceRef.current;
        if (!surface) return;

        if (previousTransitionKeyRef.current === null) {
            previousTransitionKeyRef.current = sourceTransitionKey;
            return;
        }
        if (previousTransitionKeyRef.current === sourceTransitionKey) return;
        previousTransitionKeyRef.current = sourceTransitionKey;

        if (reducedMotion || motionTokens.listReveal.duration === 0) {
            gsap.set(surface, { opacity: 1, y: 0, clearProps: "transform" });
            return;
        }

        const ctx = gsap.context(() => {
            gsap.fromTo(
                surface,
                { y: 10, opacity: 0 },
                { y: 0, opacity: 1, duration: motionTokens.listReveal.duration, ease: motionTokens.listReveal.ease, clearProps: "transform" },
            );
        }, surface);
        return () => ctx.revert();
    }, [motionTokens.listReveal.duration, motionTokens.listReveal.ease, reducedMotion, sourceTransitionKey]);


    const handleClose = () => {
        if (isSubmitting) return;
        onClose();
    };

    const clearFeedback = () => {
        if (submitError) setSubmitError(null);
        if (validationSummary) setValidationSummary(null);
    };



    const submitProject = async () => {
        setIsSubmitting(true);
        setSubmitError(null);
        setValidationSummary(null);
        setTouched(prev => ({ ...prev, path: true, slug: true }));
        try {
            if (sourceType === 'new_project') {
                await Promise.resolve(onAdd({
                    name: name.trim(),
                    type: 'new_project',
                    path: newInitMode === 'new-local' ? localPath.trim() : '',
                    initMode: newInitMode,
                    selectedTechstackId: newProjectTechstackId,
                    applicationKind: newProjectApplicationKind,
                    ...(newInitMode === 'new-remote' && gitUrlSlug.trim()
                        ? { repoSlug: gitUrlSlug.trim() }
                        : {}),
                    ...(newInitMode === 'new-remote'
                        ? {
                            remoteProvider: newProvider,
                            isPrivate: newIsPrivate,
                        }
                        : {}),
                }));
            } else {
                const path = sourceType === 'local' ? localPath.trim() : gitUrl.trim();

                await Promise.resolve(onAdd({
                    name: name.trim(),
                    type: sourceType,
                    path,
                    ...(sourceType === 'git' && cloneDir.trim() ? { cloneDir: cloneDir.trim() } : {}),
                    setup: {
                        enabled: initializeProject,
                        options: setupOptions,
                    },
                }));
            }
            handleClose();
        } catch (err) {
            setIsSubmitting(false);
            setSubmitError(err instanceof Error ? err.message : String(err));
        }
    };

    const handleSubmit = async (e: Event) => {

        e.preventDefault();

        if (Object.keys(validationErrors).length > 0) {
            setTouched({ name: true, path: sourceType === 'git', slug: sourceType === 'new_project' && newInitMode === 'new-remote' });
            setValidationSummary(translate(projectMessages, "reviewRequiredFields", {
                errors: Object.values(validationErrors).join(" "),
            }));
            setSubmitError(null);
            setTimeout(() => focusFirstInvalidField('add-project-form', 'add-project-form-body', reducedMotion), 0);
            return;
        }

        if (sourceType === 'new_project') {
            await submitProject();
            return;
        }

        if (initializeProject && !showSetupOptions) {
            setShowSetupOptions(true);
            return;
        }

        await submitProject();
    };

    const loadDirectory = async (target: DirectoryPickerTarget, directoryPath?: string) => {
        setActiveDirectoryPickerTarget(target);
        setIsDirectoryPickerLoading(true);
        setDirectoryPickerError(null);
        setDirectorySelectionMessage(null);
        setPendingDirectoryPath(directoryPath || null);
        try {
            const listing = await fetchLocalDirectories(directoryPath);
            setDirectoryListing(listing);
            setPendingDirectoryPath(null);
        } catch (err) {
            setDirectoryPickerError(err instanceof Error ? err.message : String(err));
            setPendingDirectoryPath(null);
        } finally {
            setIsDirectoryPickerLoading(false);
        }
    };

    const handleOpenDirectoryPicker = async (target: DirectoryPickerTarget) => {
        const initialPath = target === 'localPath' ? localPath.trim() : cloneDir.trim();
        if (window.codeUxDesktop?.pickDirectory) {
            try {
                const result = await window.codeUxDesktop.pickDirectory(initialPath || undefined);
                if (result.canceled || !result.filePath) {
                    return;
                }
                if (target === 'localPath') {
                    setLocalPath(result.filePath);
                    setTouched(prev => ({ ...prev, path: false }));
                } else {
                    setCloneDir(result.filePath);
                }
                clearFeedback();
                setDirectorySelectionMessage(translate(projectMessages, "selectedDirectory", { path: result.filePath }));
                setActiveDirectoryPickerTarget(null);
                return;
            } catch (err) {
                setDirectoryPickerError(err instanceof Error ? err.message : String(err));
            }
        }

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
        clearFeedback();
        setDirectorySelectionMessage(translate(projectMessages, "selectedDirectory", { path: directoryListing.currentPath }));
        setActiveDirectoryPickerTarget(null);
    };

    const handleSourceTypeChange = (type: SourceType) => {
        setSourceType(type);
        setActiveDirectoryPickerTarget(null);
        clearFeedback();
    };

    const renderDirectoryPicker = (target: DirectoryPickerTarget) => {
        if (activeDirectoryPickerTarget !== target) return null;
        const pickerId = target === 'localPath' ? "add-project-directory-picker" : "add-project-clone-directory-picker";
        const currentPath = directoryListing?.currentPath || pendingDirectoryPath || "";
        const loadingLabel = pendingDirectoryPath
            ? translate(projectMessages, "loadingPath", { path: pendingDirectoryPath })
            : translate(projectMessages, "loadingDirectories");
        const statusMessage = directoryPickerError
            ? translate(projectMessages, "directoryLoadFailed", { message: directoryPickerError })
            : isDirectoryPickerLoading
                ? loadingLabel
                : directoryListing
                    ? translatePlural(
                        projectMessages,
                        "childDirectories",
                        directoryListing.directories.length,
                        {
                            path: directoryListing.currentPath,
                        },
                    )
                    : translate(projectMessages, "directoryPickerReady");

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
                        aria-label={translate(projectMessages, "goToParentDirectory")}
                        title={translate(projectMessages, "goUp")}
                    >
                        <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => void loadDirectory(target, directoryListing?.homePath)}
                        disabled={isDirectoryPickerLoading}
                        className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm transition-all hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:text-white"
                        aria-label={translate(projectMessages, "goToHomeDirectory")}
                        title={translate(projectMessages, "home")}
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
                        aria-busy={isDirectoryPickerLoading}
                        className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm transition-all hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:text-white"
                        aria-label={translate(projectMessages, "refreshDirectories")}
                        title={translate(projectMessages, "refresh")}
                    >
                        <><RefreshCw aria-hidden="true" className={`h-4 w-4 ${isDirectoryPickerLoading ? "animate-spin" : ""}`} />{isDirectoryPickerLoading && <span className="sr-only">{translate(projectMessages, "loading")}</span>}</>
                    </button>
                    <div
                        className="min-w-0 flex-1 truncate rounded-xl bg-white px-3 py-2 font-mono text-xs font-semibold text-slate-600 dark:bg-white/[0.055] dark:text-slate-300"
                        aria-label={isDirectoryPickerLoading
                            ? loadingLabel
                            : currentPath
                                ? translate(projectMessages, "currentPath", { path: currentPath })
                                : translate(projectMessages, "directoryPickerPath")}
                    >
                        {isDirectoryPickerLoading && pendingDirectoryPath ? loadingLabel : currentPath || `${translate(projectMessages, "loadingDirectories")}...`}
                    </div>
                    <button
                        type="button"
                        onClick={handleUseDirectory}
                        disabled={!directoryListing || isDirectoryPickerLoading}
                        className="flex h-8 items-center gap-1.5 rounded-xl bg-ember-500 px-3 text-xs font-black uppercase tracking-[0.12em] text-void-900 transition-all hover:bg-ember-400 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                    >
                        <Check aria-hidden="true" className="h-3.5 w-3.5" />
                        {translate(projectMessages, "use")}
                    </button>
                </div>
                <div
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    className="border-b border-black/[0.04] px-3 py-2 text-xs font-semibold text-slate-500 dark:border-white/[0.06] dark:text-slate-400"
                >
                    {statusMessage}
                </div>
                {directoryPickerError ? (
                    <div id="directory-picker-error" role="alert" aria-live="assertive" className="flex items-center gap-2 px-3 py-3 text-xs font-semibold text-status-red">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <span>{directoryPickerError}</span>
                    </div>
                ) : (
                    <div className="max-h-44 overflow-y-auto p-2">
                        {isDirectoryPickerLoading && !directoryListing ? (
                            <div className="flex items-center gap-2 px-2 py-3 text-xs font-semibold text-slate-400">
                                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                                {loadingLabel}
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
                                {translate(projectMessages, "noChildDirectories", {
                                    path: directoryListing?.currentPath || translate(projectMessages, "directoryPickerPath"),
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    const setupOptionRows = [
        { key: "agents", label: translate(projectMessages, "setupAgents"), description: translate(projectMessages, "setupAgentsLongDescription"), icon: Bot },
        { key: "quicksprints", label: translate(projectMessages, "setupQuicksprints"), description: translate(projectMessages, "setupQuicksprintsLongDescription"), icon: Workflow },
        { key: "previewScript", label: translate(projectMessages, "setupPreviewScript"), description: translate(projectMessages, "setupPreviewScriptLongDescription"), icon: PlaySquare },
        { key: "ci", label: translate(projectMessages, "setupCi"), description: translate(projectMessages, "setupCiLongDescription"), icon: ShieldCheck },
        { key: "techstack", label: translate(projectMessages, "setupTechstack"), description: translate(projectMessages, "setupTechstackLongDescription"), icon: Layers3 },
        { key: "docs", label: translate(projectMessages, "setupDocs"), description: translate(projectMessages, "setupDocsDescription"), icon: BookOpen },
    ] as const;

    return (
        <Modal
            isOpen={true}
            onClose={handleClose}
            initialFocusRef={nameInputRef}
            ariaLabelledBy="add-project-modal-title"
            className="w-[calc(100vw-2rem)] sm:w-full max-w-2xl lg:max-w-3xl !p-0 !rounded-[2.5rem] !overflow-hidden flex flex-col"
        >
            <div
                className="relative flex flex-col sm:flex-row w-full flex-1 min-h-0"
                style={{ minHeight: modalMinHeight }}
            >
                {/* ── Left decorative panel ── */}
                <div className="relative hidden sm:flex w-52 shrink-0 bg-void-900 dark:bg-void-950 flex-col justify-between p-8 overflow-hidden">
                    <span className="absolute -top-2 -left-4 text-[7.5rem] font-black text-white/[0.035] font-display leading-none pointer-events-none select-none tracking-tighter">
                        {translate(projectMessages, "addProject")}
                    </span>
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-44 h-44 bg-ember-500/[0.08] animate-organic" style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%' }} />
                        <div className="absolute w-32 h-32 bg-ember-500/[0.12] animate-organic-reverse" style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%' }} />
                        <div className="absolute w-20 h-20 bg-ember-500/[0.18] animate-organic" style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%' }} />
                    </div>
                    <div className="relative z-10 flex items-center gap-2 text-ember-500 font-mono font-bold text-[10px] tracking-[0.2em] uppercase">
                        <FolderOpen className="w-3.5 h-3.5" strokeWidth={2.5} />
                        {translate(projectMessages, "newProject")}
                    </div>
                    <div className="relative z-10">
                        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/25 font-mono mb-1.5">{translate(projectMessages, "source")}</div>
                        <div className="text-base font-semibold text-white font-mono tracking-tight leading-snug">
                            {sourceType === 'new_project'
                                ? translate(projectMessages, "newProject")
                                : sourceType === 'git'
                                    ? translate(projectMessages, "gitRepo")
                                    : translate(projectMessages, "localProject")}
                            {quickActionContextLabel ? `: ${quickActionContextLabel}` : ''}
                        </div>
                        <div className="mt-3 w-8 h-[2px] bg-ember-500/50" />
                    </div>
                </div>

                {/* ── Right form panel ── */}
                <div className="flex-1 bg-white/98 dark:bg-void-800/98 flex flex-col min-w-0">
                    {/* Header */}
                    <div className="flex items-start justify-between shrink-0 p-5 sm:p-7 lg:px-8 lg:pt-8 lg:pb-6 border-b border-black/[0.04] dark:border-white/[0.04]">
                        <div>
                            <h2 id="add-project-modal-title" className="text-2xl font-semibold text-slate-900 dark:text-white tracking-tight font-display leading-none">
                                {quickActionDefaults?.applicationKind === "web"
                                    ? translate(projectMessages, "createWebApp")
                                    : quickActionDefaults?.applicationKind === "desktop"
                                        ? translate(projectMessages, "createDesktopApp")
                                        : `${translate(projectMessages, "addProject")}.`}
                            </h2>
                            <p className="text-xs font-medium text-slate-400 mt-2 tracking-wide">
                                {quickActionContextLabel
                                    ? translate(projectMessages, "initializeNewAppDescription", { kind: quickActionContextLabel })
                                    : translate(projectMessages, "connectRepositoryDescription")}
                            </p>
                        </div>
                        <div className="sr-only" aria-live="polite" role="status">
                            {translate(projectMessages, "sourceSelected", {
                                source: sourceType === 'new_project'
                                    ? translate(projectMessages, "newProject")
                                    : sourceType === 'git'
                                        ? translate(projectMessages, "gitRepo")
                                        : translate(projectMessages, "localProject"),
                            })}
                            {quickActionContextLabel ? `. ${translate(projectMessages, "contextSelected", { context: quickActionContextLabel })}` : ''}
                            {showSetupOptions ? `. ${translate(projectMessages, "setupOptionsStep")}` : ''}
                        </div>
                        <button
                            onClick={handleClose}
                            aria-label={translate(projectMessages, "closeDialog")}
                            disabled={isSubmitting}
                            aria-describedby={isSubmitting ? "add-project-submit-disabled-reason" : undefined}
                            className="w-9 h-9 flex items-center justify-center rounded-full bg-black/[0.05] dark:bg-white/[0.05] hover:bg-black/10 dark:hover:bg-white/10 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all active:scale-95 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500"
                        >
                            <X aria-hidden="true" className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Form */}
                    <div className="flex-1 overflow-y-auto p-5 sm:p-7 lg:px-8 lg:py-6" id="add-project-form-body">
                        <form ref={fieldsRef} id="add-project-form" onSubmit={handleSubmit} noValidate className="flex flex-col flex-1 gap-5 lg:gap-6">


                            {validationSummary ? (
                                <ActionFeedbackRegion status="error" message={validationSummary} onDismiss={() => setValidationSummary(null)} />
                            ) : submitError && (
                                <ActionFeedbackRegion
                                    status="error"
                                    message={submitError}
                                    onDismiss={() => setSubmitError(null)}
                                    retryAction={() => fieldsRef.current?.requestSubmit()}
                                    retryLabel={translate(projectMessages, "retry")}
                                />
                            )}

                            {/* Project Name */}
                            <div className="group/field">
                                <label htmlFor="add-project-name" className={fieldLabelClass}>
                                    {translate(projectMessages, "projectName")} <span className="sr-only">({translate(projectMessages, "required")})</span>
                                </label>
                                <input
                                    id="add-project-name"
                                    ref={nameInputRef}
                                    type="text"
                                    value={name}
                                    onInput={(e) => {
                                        const newName = (e.target as HTMLInputElement).value;
                                        setName(newName);
                                        if (!isSlugEdited) {
                                            setGitUrlSlug(slugify(newName));
                                        }
                                        setTouched(prev => ({ ...prev, name: true }));
                                        clearFeedback();
                                    }}
                                    placeholder={translate(projectMessages, "projectNamePlaceholder")}
                                    className={projectNameInputClass}
                                    autoComplete="off"
                                    aria-invalid={validationErrors.name && touched.name ? "true" : undefined}
                                    aria-errormessage={validationErrors.name && touched.name ? "project-name-error" : undefined}
                                    aria-describedby={validationErrors.name && touched.name ? "project-name-error" : undefined}
                                    aria-required="true"
                                    onBlur={() => setTouched(prev => ({ ...prev, name: true }))}
                                />
                                <FormError id="project-name-error" error={touched.name ? validationErrors.name : undefined} announce={false} />
                            </div>

                            {/* Source Type Toggle */}
                            <fieldset>
                                <legend className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 block mb-2.5">
                                    {translate(projectMessages, "sourceType")}
                                </legend>
                                <div className="inline-flex p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-2xl gap-1 flex-wrap">
                                    {(['local', 'git', 'new_project'] as SourceType[]).map((type) => (
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
                                                : type === 'git'
                                                    ? <GitBranch className="w-3.5 h-3.5" strokeWidth={2} />
                                                    : <Sparkles className="w-3.5 h-3.5" strokeWidth={2} />
                                            }
                                            {type === 'local'
                                                ? translate(projectMessages, "localProject")
                                                : type === 'git'
                                                    ? translate(projectMessages, "gitUrl")
                                                    : translate(projectMessages, "newProject")}
                                        </button>
                                    ))}
                                </div>
                            </fieldset>

                            {/* Conditional fields */}
                            <div
                                ref={transitionSurfaceRef}
                                className="flex flex-col gap-5 lg:gap-6"
                                data-motion-contract="listReveal"
                                style={{ transitionDuration: cssTokens.listReveal.duration, transitionTimingFunction: cssTokens.listReveal.ease }}
                            >
                            {sourceType === 'local' && (
                                <div className="group/field">
                                    <label htmlFor="add-project-path" className={`${fieldLabelClass} flex items-center gap-1.5`}>
                                        <FolderInput className="w-3 h-3" /> {translate(projectMessages, "directoryPath")}
                                        <span className="ml-1 text-slate-300 dark:text-slate-600 normal-case font-medium tracking-normal">({translate(projectMessages, "optional")})</span>
                                    </label>
                                    <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-stretch">
                                        <input
                                            id="add-project-path"
                                            type="text"
                                            value={localPath}
                                            onInput={(e) => {
                                                setLocalPath((e.target as HTMLInputElement).value);
                                                setTouched(prev => ({ ...prev, path: true }));
                                                clearFeedback();
                                            }}
                                            placeholder="/home/user/projects/my-project"
                                            className={`${detailInputSurfaceClass} min-w-0 flex-1`}
                                            autoComplete="off"
                                            aria-invalid={validationErrors.path && touched.path ? "true" : undefined}
                                            aria-errormessage={validationErrors.path && touched.path ? "project-path-error" : undefined}
                                            aria-describedby={validationErrors.path && touched.path ? "project-path-error" : undefined}
                                            onBlur={() => setTouched(prev => ({ ...prev, path: true }))}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleOpenDirectoryPicker('localPath')}
                                            className="flex shrink-0 items-center justify-center gap-2 rounded-[1.15rem] border border-black/[0.06] bg-void-900 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white transition-all duration-250 hover:-translate-y-px hover:bg-void-800 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 dark:border-white/[0.08] dark:bg-white/[0.08] dark:text-white dark:hover:bg-white/[0.12]"
                                            aria-expanded={activeDirectoryPickerTarget === 'localPath'}
                                            aria-controls="add-project-directory-picker"
                                            title={translate(projectMessages, "browseDirectories")}
                                        >
                                            <FolderOpen className="h-4 w-4" />
                                            {translate(projectMessages, "browse")}
                                        </button>
                                    </div>
                                    {renderDirectoryPicker('localPath')}
                                    {directorySelectionMessage && (
                                        <div role="status" aria-live="polite" className="mt-2 text-xs font-semibold text-status-green">
                                            {directorySelectionMessage}
                                        </div>
                                    )}
                                    <FormError id="project-path-error" error={touched.path ? validationErrors.path : undefined} announce={false} />
                                </div>
                            )}

                            {sourceType === 'git' && (
                                <>
                                    <div className="group/field">
                                        <label htmlFor="add-project-git-url" className={`${fieldLabelClass} flex items-center gap-1.5`}>
                                            <Link2 className="w-3 h-3" /> {translate(projectMessages, "repositoryUrl")} <span className="sr-only">({translate(projectMessages, "required")})</span>
                                        </label>
                                        <input
                                            id="add-project-git-url"
                                            type="text"
                                            value={gitUrl}
                                            onInput={(e) => {
                                                setGitUrl((e.target as HTMLInputElement).value);
                                                setTouched(prev => ({ ...prev, path: true }));
                                                clearFeedback();
                                            }}
                                            placeholder="https://github.com/user/repo.git"
                                            className={detailInputClass}
                                            required
                                            autoComplete="url"
                                            aria-invalid={validationErrors.path && touched.path ? "true" : undefined}
                                            aria-errormessage={validationErrors.path && touched.path ? "project-git-error" : undefined}
                                            aria-describedby={validationErrors.path && touched.path ? "project-git-error" : undefined}
                                            aria-required="true"
                                            onBlur={() => setTouched(prev => ({ ...prev, path: true }))}
                                        />
                                        <FormError id="project-git-error" error={touched.path ? validationErrors.path : undefined} announce={false} />
                                    </div>
                                    <div className="group/field">
                                        <label htmlFor="add-project-clone-dir" className={`${fieldLabelClass} flex items-center gap-1.5`}>
                                            <FolderInput className="w-3 h-3" /> {translate(projectMessages, "cloneIntoDirectory")}
                                            <span className="ml-1 text-slate-300 dark:text-slate-600 normal-case font-medium tracking-normal">({translate(projectMessages, "optional")})</span>
                                        </label>
                                        <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-stretch">
                                            <input
                                                id="add-project-clone-dir"
                                                type="text"
                                                value={cloneDir}
                                                onInput={(e) => setCloneDir((e.target as HTMLInputElement).value)}
                                                placeholder="/home/user/projects"
                                                autoComplete="off"
                                                className={`${detailInputSurfaceClass} min-w-0 flex-1`}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => handleOpenDirectoryPicker('cloneDir')}
                                                className="flex shrink-0 items-center justify-center gap-2 rounded-[1.15rem] border border-black/[0.06] bg-void-900 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white transition-all duration-250 hover:-translate-y-px hover:bg-void-800 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 dark:border-white/[0.08] dark:bg-white/[0.08] dark:text-white dark:hover:bg-white/[0.12]"
                                                aria-expanded={activeDirectoryPickerTarget === 'cloneDir'}
                                                aria-controls="add-project-clone-directory-picker"
                                                title={translate(projectMessages, "browseCloneDirectory")}
                                            >
                                                <FolderOpen className="h-4 w-4" />
                                                {translate(projectMessages, "browse")}
                                            </button>
                                        </div>
                                        {renderDirectoryPicker('cloneDir')}
                                        {directorySelectionMessage && (
                                            <div role="status" aria-live="polite" className="mt-2 text-xs font-semibold text-status-green">
                                                {directorySelectionMessage}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}

                            {sourceType !== 'new_project' && (
                                <>
                                    <div className="rounded-[1.25rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.08] dark:bg-white/[0.035]">
                                        <label className="flex cursor-pointer items-start gap-3">
                                            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border transition-all ${
                                                initializeProject
                                                    ? "border-ember-500 bg-ember-500 text-void-900"
                                                    : "border-slate-300 bg-white text-transparent dark:border-white/[0.14] dark:bg-white/[0.04]"
                                            }`}>
                                                <Check className="h-3.5 w-3.5" strokeWidth={3} />
                                            </span>
                                            <input
                                                type="checkbox"
                                                checked={initializeProject}
                                                onChange={(event) => {
                                                    setInitializeProject((event.target as HTMLInputElement).checked);
                                                    setShowSetupOptions(false);
                                                    clearFeedback();
                                                }}
                                                className="sr-only"
                                            />
                                            <span className="min-w-0">
                                                <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                                                    <Sparkles className="h-4 w-4 text-ember-500" />
                                                    {translate(projectMessages, "initializeWithSetup")}
                                                </span>
                                                <span className="mt-1 block text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                                                    {translate(projectMessages, "initializeWithSetupDescription")}
                                                </span>
                                            </span>
                                        </label>
                                    </div>

                                    {showSetupOptions && (
                                        <div className="rounded-[1.35rem] border border-black/[0.06] dark:border-white/[0.08] p-4 bg-transparent">
                                            <div className="mb-3 flex items-center justify-between gap-4">
                                                <div>
                                                    <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-ember-600 dark:text-ember-400">
                                                        {translate(projectMessages, "setupScope")}
                                                    </div>
                                                    <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                                                        {translate(projectMessages, "chooseProjectAssets")}
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setSetupOptions({ agents: true, quicksprints: true, previewScript: true, ci: true, techstack: true, docs: true })}
                                                    className="rounded-xl bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-600 shadow-sm transition-colors hover:text-slate-900 dark:bg-white/[0.08] dark:text-slate-300 dark:hover:text-white"
                                                >
                                                    {translate(projectMessages, "all")}
                                                </button>
                                            </div>
                                            <div className="grid gap-2 sm:grid-cols-2">
                                                {setupOptionRows.map(({ key, label, description, icon: Icon }) => {
                                                    const checked = setupOptions[key];
                                                    return (
                                                        <button
                                                            key={key}
                                                            type="button"
                                                            onClick={() => {
                                                                setSetupOptions(prev => ({ ...prev, [key]: !prev[key] }));
                                                                clearFeedback();
                                                            }}
                                                            className={`flex min-w-0 items-start gap-3 rounded-2xl border p-3 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 ${
                                                                checked
                                                                    ? "border-ember-500/35 bg-ember-500/[0.08] text-slate-900 dark:text-white"
                                                                    : "border-black/[0.06] bg-black/[0.025] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-400"
                                                            }`}
                                                            aria-pressed={checked}
                                                        >
                                                            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${checked ? "bg-ember-500 text-void-900" : "bg-black/[0.04] text-slate-400 dark:bg-white/[0.06]"}`}>
                                                                <Icon className="h-4 w-4" />
                                                            </span>
                                                            <span className="min-w-0 flex-1">
                                                                <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.12em]">
                                                                    {label}
                                                                    {key === "previewScript" && (
                                                                        <Info 
                                                                            className="h-3.5 w-3.5 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 cursor-help" 
                                                                            title={translate(projectMessages, "previewScriptHelp")}
                                                                            onClick={(e) => e.stopPropagation()} 
                                                                        />
                                                                    )}
                                                                </span>
                                                                <span className="mt-1 block text-[11px] font-medium leading-snug opacity-75">{description}</span>
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            {sourceType === 'new_project' && (
                                <>
                                    <fieldset>
                                        <legend className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 block mb-2.5">
                                            {translate(projectMessages, "initMode")}
                                        </legend>
                                        <div className="inline-flex p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-2xl gap-1 flex-wrap">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setNewInitMode('new-local');
                                                    clearFeedback();
                                                }}
                                                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-[0.14em] transition-all active:scale-95 duration-250 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 ${
                                                    newInitMode === 'new-local'
                                                        ? 'bg-ember-500 text-void-900 shadow-[0_2px_12px_rgba(255,184,0,0.3)]'
                                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                                }`}
                                            >
                                                <FolderInput className="w-3.5 h-3.5" strokeWidth={2} />
                                                {translate(projectMessages, "localRepo")}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setNewInitMode('new-remote');
                                                    clearFeedback();
                                                }}
                                                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-[0.14em] transition-all active:scale-95 duration-250 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 ${
                                                    newInitMode === 'new-remote'
                                                        ? 'bg-ember-500 text-void-900 shadow-[0_2px_12px_rgba(255,184,0,0.3)]'
                                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                                }`}
                                            >
                                                <Cloud className="w-3.5 h-3.5" strokeWidth={2} />
                                                {translate(projectMessages, "remoteRepo")}
                                            </button>
                                        </div>
                                    </fieldset>

                                    {newInitMode === 'new-local' ? (
                                        <div className="group/field">
                                            <label htmlFor="add-project-new-path" className={`${fieldLabelClass} flex items-center gap-1.5`}>
                                                <FolderInput className="w-3 h-3" /> {translate(projectMessages, "directoryPath")}
                                                <span className="ml-1 text-slate-300 dark:text-slate-600 normal-case font-medium tracking-normal">({translate(projectMessages, "optional")})</span>
                                            </label>
                                            <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-stretch">
                                                <input
                                                    id="add-project-new-path"
                                                    type="text"
                                                    value={localPath}
                                                    onInput={(e) => {
                                                        setLocalPath((e.target as HTMLInputElement).value);
                                                        setTouched(prev => ({ ...prev, path: true }));
                                                        clearFeedback();
                                                    }}
                                                    placeholder="/home/user/projects/my-project"
                                                    className={`${detailInputSurfaceClass} min-w-0 flex-1`}
                                                    aria-invalid={validationErrors.path && touched.path ? "true" : undefined}
                                                    aria-errormessage={validationErrors.path && touched.path ? "project-new-path-error" : undefined}
                                                    aria-describedby={validationErrors.path && touched.path ? "project-new-path-error" : undefined}
                                                    onBlur={() => setTouched(prev => ({ ...prev, path: true }))}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => handleOpenDirectoryPicker('localPath')}
                                                    className="flex shrink-0 items-center justify-center gap-2 rounded-[1.15rem] border border-black/[0.06] bg-void-900 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white transition-all duration-250 hover:-translate-y-px hover:bg-void-800 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 dark:border-white/[0.08] dark:bg-white/[0.08] dark:text-white dark:hover:bg-white/[0.12]"
                                                    aria-expanded={activeDirectoryPickerTarget === 'localPath'}
                                                    aria-controls="add-project-directory-picker"
                                                    title={translate(projectMessages, "browseDirectories")}
                                                >
                                                    <FolderOpen className="h-4 w-4" />
                                                    {translate(projectMessages, "browse")}
                                                </button>
                                            </div>
                                            {renderDirectoryPicker('localPath')}
                                            {directorySelectionMessage && (
                                                <div role="status" aria-live="polite" className="mt-2 text-xs font-semibold text-status-green">
                                                    {directorySelectionMessage}
                                                </div>
                                            )}
                                            <FormError id="project-new-path-error" error={touched.path ? validationErrors.path : undefined} announce={false} />
                                        </div>
                                    ) : (
                                        <>
                                            <div className="group/field">
                                                <label htmlFor="add-project-git-slug" className={`${fieldLabelClass} flex items-center gap-1.5`}>
                                                    <GitBranch className="w-3.5 h-3.5" /> {translate(projectMessages, "gitUrlSlug")}
                                                </label>
                                                <input
                                                    id="add-project-git-slug"
                                                    type="text"
                                                    value={gitUrlSlug}
                                                    onInput={(e) => {
                                                        setGitUrlSlug((e.target as HTMLInputElement).value);
                                                        setIsSlugEdited(true);
                                                        setTouched(prev => ({ ...prev, slug: true }));
                                                        clearFeedback();
                                                    }}
                                                    placeholder="my-awesome-project"
                                                    className={detailInputClass}
                                                    autoComplete="off"
                                                    aria-invalid={validationErrors.slug && touched.slug ? "true" : undefined}
                                                    aria-errormessage={validationErrors.slug && touched.slug ? "project-git-slug-error" : undefined}
                                                    aria-describedby={validationErrors.slug && touched.slug ? "project-git-slug-error" : undefined}
                                                    aria-required="true"
                                                    onBlur={() => setTouched(prev => ({ ...prev, slug: true }))}
                                                />
                                                <FormError id="project-git-slug-error" error={touched.slug ? validationErrors.slug : undefined} announce={false} />
                                            </div>
                                            <div className="group/field">
                                                <div className="flex items-center justify-between gap-3">
                                                    <label className={fieldLabelClass}>
                                                        {translate(projectMessages, "provider")}
                                                    </label>
                                                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                                                        {translate(projectMessages, "providerDetectionHint")}
                                                    </span>
                                                </div>
                                                <div className="mt-2.5 inline-flex p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-2xl gap-1 flex-wrap">
                                                    <button
                                                        type="button"
                                                        onClick={() => setNewProvider('github')}
                                                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-[0.14em] transition-all active:scale-95 duration-250 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 ${
                                                            newProvider === 'github'
                                                                ? 'bg-ember-500 text-void-900 shadow-[0_2px_12px_rgba(255,184,0,0.3)]'
                                                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                                        }`}
                                                    >
                                                        GitHub
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setNewProvider('gitlab')}
                                                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-[0.14em] transition-all active:scale-95 duration-250 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 ${
                                                            newProvider === 'gitlab'
                                                                ? 'bg-ember-500 text-void-900 shadow-[0_2px_12px_rgba(255,184,0,0.3)]'
                                                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                                        }`}
                                                    >
                                                        GitLab
                                                    </button>
                                                </div>
                                            </div>

                                            <fieldset>
                                                <legend className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 block mb-2.5">
                                                    {translate(projectMessages, "visibility")}
                                                </legend>
                                                <div className="inline-flex p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-2xl gap-1 flex-wrap">
                                                    <button
                                                        type="button"
                                                        onClick={() => setNewIsPrivate(true)}
                                                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-[0.14em] transition-all active:scale-95 duration-250 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 ${
                                                            newIsPrivate
                                                                ? 'bg-ember-500 text-void-900 shadow-[0_2px_12px_rgba(255,184,0,0.3)]'
                                                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                                        }`}
                                                    >
                                                        <Lock className="w-3.5 h-3.5" strokeWidth={2} />
                                                        {translate(projectMessages, "private")}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setNewIsPrivate(false)}
                                                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-[0.14em] transition-all active:scale-95 duration-250 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 ${
                                                            !newIsPrivate
                                                                ? 'bg-ember-500 text-void-900 shadow-[0_2px_12px_rgba(255,184,0,0.3)]'
                                                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                                        }`}
                                                    >
                                                        <Globe className="w-3.5 h-3.5" strokeWidth={2} />
                                                        {translate(projectMessages, "public")}
                                                    </button>
                                                </div>
                                            </fieldset>
                                        </>
                                    )}
                                </>
                            )}
                            </div>


                            </form>
                    </div>
                    {/* Actions */}
                    <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between shrink-0 p-5 sm:p-7 lg:px-8 lg:py-6 border-t border-black/[0.04] dark:border-white/[0.04] bg-white/50 dark:bg-void-800/50 gap-3">
                                <button
                                    type="button"
                                    onClick={handleClose}
                                    disabled={isSubmitting}
                                    aria-describedby={isSubmitting ? "add-project-submit-disabled-reason" : undefined}
                                    title={isSubmitting ? translate(projectMessages, "projectCreationInProgress") : undefined}
                                    className="text-sm font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 rounded w-full sm:w-auto py-2 sm:py-0 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {translate(projectMessages, "cancel")}
                                </button>
                                <button type="submit" form="add-project-form" disabled={isSubmitting}
                                    aria-busy={isSubmitting}
                                    aria-describedby={isSubmitting ? "add-project-submit-disabled-reason" : undefined}
                                    title={isSubmitting ? translate(projectMessages, "projectCreationInProgress") : undefined}
                                    className="group/btn flex items-center justify-center gap-2.5 px-6 py-3 bg-ember-500 w-full sm:w-auto  hover:bg-ember-400 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400 text-void-900 font-bold text-sm rounded-2xl transition-all duration-300 shadow-[0_4px_20px_rgba(255,184,0,0.25)] hover:shadow-[0_8px_32px_rgba(255,184,0,0.4)] disabled:shadow-none active:scale-95 disabled:active:scale-100 hover:-translate-y-px disabled:hover:-translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500"
                                >
                                    {isSubmitting ? (
                                        <><Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /><span className="sr-only">{translate(projectMessages, "loading")}</span></>
                                    ) : (
                                        <Plus className="w-4 h-4 group-hover/btn:rotate-90 transition-transform duration-300" />
                                    )}
                                    {isSubmitting
                                        ? translate(projectMessages, sourceType !== 'new_project' && initializeProject ? "settingUp" : "adding")
                                        : translate(projectMessages, sourceType !== 'new_project' && initializeProject && !showSetupOptions ? "continue" : "addProject")}
                                </button>
                                <span id="add-project-submit-disabled-reason" className="sr-only">
                                    {translate(projectMessages, "projectCreationDisabledReason")}
                                </span>
                            </div>
                </div>
            </div>
        </Modal>
    );
};
