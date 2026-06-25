import type { FunctionComponent, JSX } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { useNavigate } from "@tanstack/react-router";
import {
    Bot,
    Check,
    Clock3,
    ExternalLink,
    FolderOpen,
    GitBranch,
    Globe,
    Loader2,
    MapPin,
    Plus,
    Settings,
    Sparkles,
    Trash2,
} from "lucide-preact";
import type { Source, SourceStatus } from "./types.js";
import { AddProjectModal, type AddProjectModalSubmission, type SourceType as AddProjectModalSourceType } from "./components/ui/AddProjectModal.js";
import { StatusDot } from "./components/ui/StatusDot.js";
import { WaveFluid } from "./components/ui/WaveFluid.js";
import { BorderTrace } from "./components/ui/BorderTrace.js";
import { useProjectData } from "./context/project-data.js";
import { SkeletonPanel, SkeletonLoader } from "./components/layout/SkeletonLoader.js";
import { PageContainer } from "./components/layout/PageContainer.js";
import { startProjectSetup } from "./lib/project-api.js";
import { fetchProjectInvocations } from "./lib/invocation-api.js";
import { useToast } from "./components/feedback/ToastProvider.js";
import { prefetchRoute } from "./router/route-prefetch.js";
import { buildProjectCardViewModel, PROJECT_CARD_EMPTY_VALUE } from "./lib/project-card-view-model.js";

const EMBER_HEX = '#FFB800';


type Filter = 'All' | 'Running' | 'Idle' | 'Failed';

const statusLabel: Record<SourceStatus, string> = {
    running:      'Running',
    failed:       'Failed',
    intervention: 'Needs Review',
    idle:         'Idle',
};

const statusColor: Record<SourceStatus, string> = {
    running:      'text-status-green',
    failed:       'text-status-red',
    intervention: 'text-status-amber',
    idle:         'text-slate-400 dark:text-slate-500',
};

type ProjectCardActionKind = "open-project" | "setup-project" | "settings" | "delete";

const ACTION_ICON_CLASS = "w-3.5 h-3.5 shrink-0";
type ProjectMetaCardIcon = any;

/* ─── Project Card ──────────────────────────────────────────────────────── */

const ProjectMetaCard: FunctionComponent<{
    label: string;
    value: string;
    isEmpty: boolean;
    description?: string;
    icon?: ProjectMetaCardIcon;
}> = ({ label, value, isEmpty, description, icon: Icon }) => (
    <div className="rounded-[1.2rem] border border-black/[0.06] bg-black/[0.03] p-3.5 dark:border-white/[0.06] dark:bg-white/[0.03]">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
            {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} aria-hidden="true" /> : null}
            <span>{label}</span>
        </div>
        <div className={`mt-2 break-words text-sm font-semibold leading-snug ${isEmpty ? "text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-white"}`}>
            {value}
        </div>
        {description ? (
            <div className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-500">
                {description}
            </div>
        ) : null}
    </div>
);

const ProjectActionIcon = ({ kind }: { kind: ProjectCardActionKind }) => {
    switch (kind) {
        case "open-project":
            return <ExternalLink className={ACTION_ICON_CLASS} strokeWidth={2.2} aria-hidden="true" />;
        case "setup-project":
            return <Bot className={ACTION_ICON_CLASS} strokeWidth={2.2} aria-hidden="true" />;
        case "settings":
            return <Settings className={ACTION_ICON_CLASS} strokeWidth={2.2} aria-hidden="true" />;
        case "delete":
            return <Trash2 className={ACTION_ICON_CLASS} strokeWidth={2.2} aria-hidden="true" />;
    }
};

const ProjectCard: FunctionComponent<{
    source: Source;
    isSelected: boolean;
    isSettingUp: boolean;
    setupInvocationId?: string | null;
    onSelect: () => void;
    onDelete: () => void;
    onSetup: () => void;
    onOpenInvocation: () => void;
    onSettings: () => void;
}> = ({ source, isSelected, isSettingUp, setupInvocationId, onSelect, onDelete, onSetup, onOpenInvocation, onSettings }) => {
    const cardRef = useRef<HTMLDivElement>(null);
    const viewModel = useMemo(() => buildProjectCardViewModel(source), [source]);
    const statusText = statusLabel[source.status];
    const statusClass = statusColor[source.status];
    const isRunning = source.status === "running";
    const totalTasks = source.completedTasks + source.openTasks;
    const completion = totalTasks > 0 ? Math.round((source.completedTasks / totalTasks) * 100) : 0;
    const isCardSelected = isSelected;
    const gitUrlValue = viewModel.gitUrl.isEmpty
        ? (source.sourceType === "local" ? "No git URL configured" : "No repository URL available")
        : viewModel.gitUrl.value;
    const gitUrlDescription = viewModel.gitUrl.isEmpty
        ? (source.sourceType === "local" ? "Local projects only need a workspace path." : "A git project should usually expose a repository URL.")
        : undefined;
    const branchValue = viewModel.branch.isEmpty ? "No default branch set" : viewModel.branch.value;
    const branchDescription = viewModel.branch.isEmpty ? "Set a default branch to simplify sprint setup." : undefined;
    const lastRunValue = viewModel.lastRunAt.isEmpty ? "No runs yet" : viewModel.lastRunAt.value;
    const lastRunDescription = viewModel.lastRunAt.isEmpty
        ? "Project runs will appear here after the first setup or sprint execution."
        : viewModel.lastRunStatus.isEmpty ? "Latest run timestamp" : `Latest run status: ${viewModel.lastRunStatus.value}`;
    const providerValue = viewModel.providerLabel.isEmpty ? PROJECT_CARD_EMPTY_VALUE : viewModel.providerLabel.value;
    const providerDescription = source.gitProvider === "local" ? "Managed locally" : "Remote provider";
    const hostValue = viewModel.hostLabel.isEmpty ? "No host" : viewModel.hostLabel.value;
    const hostDescription = viewModel.hostLabel.isEmpty ? "No remote host has been detected." : "Repository host";
    const selectedLabel = isCardSelected ? "Selected project" : "Select project";
    const actionClass = "inline-flex items-center justify-center gap-2 rounded-[1rem] border px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-500/30";

    const handleSelect = () => {
        onSelect();
    };

    const handleKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
        if (event.currentTarget !== event.target) {
            return;
        }
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
        }
    };

    useEffect(() => {
        return () => {
            if (cardRef.current) {
                gsap.killTweensOf(cardRef.current);
            }
        };
    }, []);

    return (
        <div
            ref={cardRef}
            role="button"
            tabIndex={0}
            aria-pressed={isCardSelected}
            aria-label={`${selectedLabel}: ${source.name}`}
            title={`${selectedLabel}: ${source.name}`}
            onClick={handleSelect}
            onKeyDown={handleKeyDown}
            onMouseEnter={() => {
                if (!cardRef.current) return;
                gsap.to(cardRef.current, {
                    y: -4,
                    scale: 1.01,
                    duration: 0.45,
                    ease: "back.out(1.8)",
                    overwrite: "auto",
                });
            }}
            onMouseLeave={() => {
                if (!cardRef.current) return;
                gsap.to(cardRef.current, {
                    y: 0,
                    scale: 1,
                    duration: 0.65,
                    ease: "power2.out",
                    overwrite: "auto",
                });
            }}
            className="group relative h-full outline-none focus-visible:ring-2 focus-visible:ring-ember-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
        >
            {isRunning && (
                <div
                    className="pointer-events-none absolute inset-0 rounded-[1.75rem] scale-[1.01]"
                    style={{ boxShadow: "0 0 0 1px rgba(0,171,132,0.42), 0 0 24px rgba(0,171,132,0.14)" }}
                />
            )}

            <div
                className={`relative flex h-full flex-col overflow-hidden rounded-[1.75rem] border backdrop-blur-2xl transition-shadow duration-300 ${
                    isCardSelected
                        ? "border-ember-500/45 bg-white/78 shadow-[0_10px_30px_rgba(255,184,0,0.08)] ring-1 ring-ember-500/20 dark:bg-void-800/78"
                        : "border-black/[0.06] bg-white/72 shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:border-white/[0.06] dark:bg-void-800/64 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]"
                }`}
            >
                <div className="absolute inset-0 bg-signal-500/[0.025] opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100" />
                <div className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,184,0,0.08)_0%,transparent_100%)] opacity-60" />
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -bottom-6 -right-2 select-none font-display text-[6rem] font-black leading-none tracking-tighter text-black/[0.03] dark:text-white/[0.025]"
                >
                    {source.name.slice(0, 3).toUpperCase()}
                </div>
                <WaveFluid accentHex={EMBER_HEX} />
                <BorderTrace accentHex={EMBER_HEX} />

                <div className="relative z-10 flex flex-1 flex-col gap-4 p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <h3 className="truncate font-display text-[1.05rem] font-black tracking-tight text-slate-900 dark:text-white">
                                    {source.name}
                                </h3>
                                {isCardSelected ? (
                                    <span className="inline-flex items-center gap-1 rounded-full border border-ember-500/20 bg-ember-500/[0.12] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-ember-700 dark:text-ember-200">
                                        <Check className="h-3 w-3" strokeWidth={3} aria-hidden={true} />
                                        Selected
                                    </span>
                                ) : null}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                                <span className="font-mono">{source.id}</span>
                                <span className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" aria-hidden="true" />
                                <span className={statusClass}>
                                    <StatusDot status={source.status} />
                                    <span>{statusText}</span>
                                </span>
                            </div>
                            <div className="mt-2 text-[11px] leading-snug text-slate-500 dark:text-slate-500">
                                {viewModel.sourceBadge.description}
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
                                viewModel.sourceBadge.kind === "remote-git"
                                    ? "border-status-green/20 bg-status-green/[0.08] text-status-green"
                                    : viewModel.sourceBadge.kind === "local-repository"
                                        ? "border-signal-500/20 bg-signal-500/[0.1] text-signal-700 dark:text-signal-300"
                                        : "border-black/[0.06] bg-black/[0.03] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300"
                            }`}>
                                {viewModel.sourceBadge.label}
                            </div>
                        </div>
                    </div>

                    {isSettingUp ? (
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                if (setupInvocationId) {
                                    onOpenInvocation();
                                }
                            }}
                            className="flex items-center justify-between rounded-[1.25rem] border border-ember-500/25 bg-ember-500/[0.08] px-3 py-2.5 text-left text-ember-700 transition-colors hover:bg-ember-500/[0.12] dark:text-ember-200"
                            disabled={!setupInvocationId}
                            title={setupInvocationId ? "Open setup invocation" : "Invocation starting"}
                        >
                            <span className="flex items-center gap-2">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span className="text-[10px] font-black uppercase tracking-[0.14em]">
                                    Project setup running
                                </span>
                            </span>
                            <span className="ml-3 font-mono text-[10px] font-bold opacity-80">
                                {setupInvocationId ? setupInvocationId.slice(0, 8) : "starting"}
                            </span>
                        </button>
                    ) : null}

                    <div className="grid gap-3 sm:grid-cols-2">
                        <ProjectMetaCard
                            label="Git URL"
                            value={gitUrlValue}
                            isEmpty={viewModel.gitUrl.isEmpty}
                            description={gitUrlDescription}
                            icon={Globe}
                        />
                        <ProjectMetaCard
                            label="Local directory"
                            value={viewModel.localDirectory.value}
                            isEmpty={viewModel.localDirectory.isEmpty}
                            description={viewModel.localDirectory.isEmpty ? "This project has no recorded local workspace path." : undefined}
                            icon={MapPin}
                        />
                        <ProjectMetaCard
                            label="Created"
                            value={viewModel.createdAt.value}
                            isEmpty={viewModel.createdAt.isEmpty}
                            description={viewModel.createdAt.isEmpty ? "Creation time is unavailable." : undefined}
                            icon={Clock3}
                        />
                        <ProjectMetaCard
                            label="Updated"
                            value={viewModel.updatedAt.value}
                            isEmpty={viewModel.updatedAt.isEmpty}
                            description={viewModel.updatedAt.isEmpty ? "Last update time is unavailable." : undefined}
                            icon={Clock3}
                        />
                        <ProjectMetaCard
                            label="Last run"
                            value={lastRunValue}
                            isEmpty={viewModel.lastRunAt.isEmpty}
                            description={lastRunDescription}
                            icon={Clock3}
                        />
                        <ProjectMetaCard
                            label="Branch"
                            value={branchValue}
                            isEmpty={viewModel.branch.isEmpty}
                            description={branchDescription}
                            icon={GitBranch}
                        />
                        <ProjectMetaCard
                            label="Provider"
                            value={providerValue}
                            isEmpty={viewModel.providerLabel.isEmpty}
                            description={providerDescription}
                            icon={Settings}
                        />
                        <ProjectMetaCard
                            label="Host"
                            value={hostValue}
                            isEmpty={viewModel.hostLabel.isEmpty}
                            description={hostDescription}
                            icon={Globe}
                        />
                    </div>

                    <div className="grid gap-3 rounded-[1.25rem] border border-black/[0.05] bg-black/[0.02] p-3 dark:border-white/[0.05] dark:bg-white/[0.02] sm:grid-cols-3">
                        <div className="rounded-[1rem] border border-black/[0.05] bg-white/55 px-3 py-2 dark:border-white/[0.05] dark:bg-white/[0.03]">
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Sprints</div>
                            <div className="mt-1 text-lg font-black text-slate-900 dark:text-white">
                                {source.sprintsCount}
                            </div>
                        </div>
                        <div className="rounded-[1rem] border border-black/[0.05] bg-white/55 px-3 py-2 dark:border-white/[0.05] dark:bg-white/[0.03]">
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Open tasks</div>
                            <div className="mt-1 text-lg font-black text-slate-900 dark:text-white">
                                {source.openTasks}
                            </div>
                        </div>
                        <div className="rounded-[1rem] border border-black/[0.05] bg-white/55 px-3 py-2 dark:border-white/[0.05] dark:bg-white/[0.03]">
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Done</div>
                            <div className="mt-1 text-lg font-black text-slate-900 dark:text-white">
                                {source.completedTasks}
                            </div>
                        </div>
                    </div>

                    <div className="mt-auto grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        {viewModel.actions.map((action) => {
                            const isSetupAction = action.kind === "setup-project";
                            const isDanger = action.tone === "danger";
                            const isDisabled = isSetupAction && isSettingUp;
                            const handleAction = () => {
                                switch (action.kind) {
                                    case "open-project":
                                        onSelect();
                                        return;
                                    case "setup-project":
                                        onSetup();
                                        return;
                                    case "settings":
                                        onSettings();
                                        return;
                                    case "delete":
                                        onDelete();
                                        return;
                                }
                            };

                            return (
                                <button
                                    key={action.kind}
                                    type="button"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        if (isDisabled) {
                                            return;
                                        }
                                        handleAction();
                                    }}
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onMouseEnter={(event) => {
                                        event.stopPropagation();
                                        if (action.kind === "settings") {
                                            prefetchRoute("/config");
                                        }
                                    }}
                                    onFocus={(event) => {
                                        event.stopPropagation();
                                        if (action.kind === "settings") {
                                            prefetchRoute("/config");
                                        }
                                    }}
                                    disabled={isDisabled}
                                    aria-label={action.ariaLabel}
                                    title={isDisabled ? "Project setup is already running" : action.title}
                                    aria-busy={isDisabled}
                                    className={`${actionClass} ${
                                        isDanger
                                            ? "border-status-red/20 bg-status-red/[0.06] text-status-red hover:bg-status-red/[0.12]"
                                            : "border-black/[0.06] bg-white/80 text-slate-600 hover:bg-black/[0.05] hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
                                    } ${isDisabled ? "cursor-not-allowed opacity-60" : ""}`}
                                >
                                    <ProjectActionIcon kind={action.kind} />
                                    <span className="truncate">{action.label}</span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-1 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                        <span className="truncate">
                            Last run status: {viewModel.lastRunStatus.isEmpty ? "No run recorded" : viewModel.lastRunStatus.value}
                        </span>
                        <span className="shrink-0 font-mono">
                            {completion}% complete
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};

/* ─── Ghost "Add Project" Card ──────────────────────────────────────────── */

const AddCard: FunctionComponent<{ onClick: () => void }> = ({ onClick }) => (
    <button
        onClick={onClick}
        className="group relative flex h-full min-h-[260px] w-full flex-col items-center justify-center gap-5
                   p-7
                   bg-white/55 dark:bg-void-800/40
                   backdrop-blur-2xl
                   border border-dashed border-black/[0.1] dark:border-white/[0.1] hover:border-signal-500/50
                   rounded-[1.75rem]
                   shadow-[0_2px_20px_rgba(0,0,0,0.03)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.18)]
                   transition-colors duration-500
                   hover:bg-signal-500/[0.025] cursor-pointer"
    >
        {/* Simple Icon */}
        <div className="w-12 h-12 flex items-center justify-center rounded-xl bg-black/[0.02] dark:bg-white/[0.02] group-hover:bg-signal-500/[0.1] transition-colors duration-300">
            <Plus className="w-5 h-5 text-slate-400 group-hover:text-signal-500" strokeWidth={2} />
        </div>

        <div className="flex flex-col items-center gap-1.5">
            <span className="text-xs font-bold uppercase tracking-[0.2em]
                             text-slate-300 dark:text-slate-600
                             group-hover:text-signal-500 transition-colors duration-300">
                Add Project
            </span>
            <span className="text-[9px] font-mono text-slate-200 dark:text-slate-700
                             group-hover:text-slate-400 transition-colors duration-200">
                Local or Git
            </span>
        </div>
    </button>
);

/* ─── Projects Page ─────────────────────────────────────────────────────── */

export const ProjectsPage: FunctionComponent = () => {
    const mainRef      = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();
    const [showModal, setShowModal]   = useState(false);
    const [modalSourceType, setModalSourceType] = useState<AddProjectModalSourceType>('local');
    const [setupProjectId, setSetupProjectId] = useState<string | null>(null);
    const [runningSetupProjectIds, setRunningSetupProjectIds] = useState<Set<string>>(() => new Set());
    const [setupInvocationByProjectId, setSetupInvocationByProjectId] = useState<Record<string, string>>({});
    const [setupError, setSetupError] = useState<string | null>(null);
    const [setupOptions, setSetupOptions] = useState({
        agents: true,
        quicksprints: true,
        previewScript: true,
        ci: true,
    });
    const [activeFilter, setActiveFilter] = useState<Filter>('All');
    const {
        projects: sources,
        selectedProjectId,
        loading,
        createProject,
        deleteProject,
        selectProject,
    } = useProjectData();
    const { addToast } = useToast();

    const [showSkeletons, setShowSkeletons] = useState(false);

    useEffect(() => {
        let timeoutId: number;
        if (loading) {
            timeoutId = window.setTimeout(() => setShowSkeletons(true), 200);
        } else {
            setShowSkeletons(false);
        }
        return () => window.clearTimeout(timeoutId);
    }, [loading]);

    useLayoutEffect(() => {
        if (!mainRef.current) return;
        const ctx = gsap.context(() => {
            gsap.fromTo(
                mainRef.current!.children,
                { opacity: 0, y: 40 },
                { opacity: 1, y: 0, stagger: 0.1, duration: 0.9, ease: "power4.out", delay: 0.1 },
            );
        });
        return () => ctx.revert();
    }, []);

    useLayoutEffect(() => {
        if (!gridRef.current || loading || showSkeletons) return;
        const projectCards = Array.from(gridRef.current.querySelectorAll(".project-card-entry"));
        if (projectCards.length === 0) return;
        const ctx = gsap.context(() => {
            gsap.fromTo(
                projectCards,
                { opacity: 0, y: 15, scale: 0.98 },
                {
                    opacity: 1,
                    y: 0,
                    scale: 1,
                    stagger: { amount: 0.2, from: "start" },
                    duration: 0.6,
                    ease: "power2.out",
                    delay: 0.05,
                }
            );
        });
        return () => ctx.revert();
    }, [loading, showSkeletons, activeFilter]);

    const openInvocation = (invocationId: string) => {
        window.location.href = `/chat?mode=invocations&invocation=${encodeURIComponent(invocationId)}`;
    };

    const openProjectSettings = (projectId: string) => {
        void selectProject(projectId);
        navigate({ to: "/config" });
    };

    const waitForSetupInvocation = async (projectId: string, invocationId: string) => {
        for (;;) {
            await new Promise(resolve => window.setTimeout(resolve, 3000));
            const invocations = await fetchProjectInvocations(projectId);
            const invocation = invocations.find(candidate => candidate.id === invocationId);
            if (!invocation || invocation.status === "running") {
                continue;
            }
            return invocation;
        }
    };

    const launchProjectSetup = (
        projectId: string,
        projectName: string,
        options: {
            agents: boolean;
            quicksprints: boolean;
            previewScript: boolean;
            ci: boolean;
        },
    ) => {
        setRunningSetupProjectIds(prev => new Set(prev).add(projectId));
        addToast({
            type: "info",
            message: `Starting project initialization for ${projectName}. The invocation rail will open as soon as tracking is ready.`,
            autoDismissMs: 7000,
        });

        void startProjectSetup(projectId, {
            enabled: true,
            options,
        }).then((started) => {
            setSetupInvocationByProjectId(prev => ({ ...prev, [projectId]: started.invocationId }));
            addToast({
                type: "info",
                message: `Project initialization is running for ${projectName}. Invocation ${started.invocationId.slice(0, 8)} is available now.`,
                autoDismissMs: 0,
                action: {
                    label: "Open invocation",
                    onClick: () => openInvocation(started.invocationId),
                },
            });
            return waitForSetupInvocation(projectId, started.invocationId).then((invocation) => ({
                started,
                invocation,
            }));
        }).then(({ started, invocation }) => {
            if (invocation.status === "failed") {
                throw new Error(invocation.lastErrorMessage || "Project initialization invocation failed.");
            }
            addToast({
                type: "success",
                message: `Project initialization finished for ${projectName}. Review the invocation output for generated artifacts.`,
                autoDismissMs: 9000,
                action: {
                    label: "Open invocation",
                    onClick: () => openInvocation(started.invocationId),
                },
            });
        }).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            addToast({
                type: "error",
                message: `Project initialization failed for ${projectName}: ${message}`,
                autoDismissMs: 0,
            });
        }).finally(() => {
            setRunningSetupProjectIds(prev => {
                const next = new Set(prev);
                next.delete(projectId);
                return next;
            });
        });
    };

    const handleAddProject = async (project: AddProjectModalSubmission) => {
        if (project.type === 'new_project') {
            const sourceRef = project.initMode === 'new-local'
                ? (project.path || project.name)
                : (project.repoSlug || project.name);

            await createProject({
                name: project.name,
                sourceType: project.initMode === 'new-local' ? 'local' : 'git',
                sourceRef,
                initMode: project.initMode,
                remoteProvider: project.remoteProvider,
                isPrivate: project.isPrivate,
            });
            return;
        }

        const createdProject = await createProject({
            name: project.name,
            sourceType: project.type,
            sourceRef: project.path,
            cloneDir: project.cloneDir,
        });
        if (project.setup?.enabled) {
            launchProjectSetup(createdProject.id, createdProject.name, project.setup.options);
        }
    };

    const activeSetupProject = sources.find(source => source.id === setupProjectId) || null;

    const handleRunSetup = async () => {
        if (!setupProjectId) return;
        setSetupError(null);
        const project = activeSetupProject;
        setSetupProjectId(null);
        if (!project) return;
        launchProjectSetup(project.id, project.name, setupOptions);
    };

    const isActiveSetupRunning = activeSetupProject
        ? runningSetupProjectIds.has(activeSetupProject.id)
        : false;

    const filterMap: Record<Filter, SourceStatus | null> = {
        All:     null,
        Running: 'running',
        Idle:    'idle',
        Failed:  'failed',
    };

    const filtered = activeFilter === 'All'
        ? sources
        : sources.filter(s => s.status === filterMap[activeFilter]);

    const runningCount = sources.filter(s => s.status === 'running').length;
    const counts: Record<Filter, number> = {
        All:     sources.length,
        Running: sources.filter(s => s.status === 'running').length,
        Idle:    sources.filter(s => s.status === 'idle').length,
        Failed:  sources.filter(s => s.status === 'failed').length,
    };

    return (
        <>
            <PageContainer aria-label="Projects" containerRef={mainRef} className="gap-16">
                {/* ── Ambient glows (max 2 per page) ─────────────────── */}
                <div
                    aria-hidden="true"
                    className="fixed inset-0 pointer-events-none -z-10"
                >
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_-5%_-10%,rgba(255,184,0,0.04)_0%,transparent_60%)]
                                   dark:bg-[radial-gradient(ellipse_70%_50%_at_-5%_-10%,rgba(255,184,0,0.06)_0%,transparent_60%)]" />
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_105%_110%,rgba(0,224,160,0.03)_0%,transparent_60%)]
                                   dark:bg-[radial-gradient(ellipse_50%_40%_at_105%_110%,rgba(0,224,160,0.05)_0%,transparent_60%)]" />
                </div>

                {/* ── Page Header ─────────────────────────────────────── */}
                <div className="flex items-end justify-between gap-8">
                    <div className="flex flex-col gap-5">
                        {/* Eyebrow */}
                        <div className="flex items-center gap-2.5 text-ember-500 font-bold tracking-[0.2em] uppercase text-[10px] font-mono">
                            <FolderOpen className="w-3.5 h-3.5" strokeWidth={2.5} />
                            Source Repositories
                        </div>

                        {/* Hero headline with ghost watermark */}
                        <div className="relative overflow-hidden">
                            <h2
                                aria-hidden="true"
                                className="text-[7rem] font-black tracking-tighter
                                           text-black/[0.04] dark:text-white/[0.03]
                                           absolute -top-10 -left-3
                                           pointer-events-none select-none font-display leading-none"
                            >
                                PROJ
                            </h2>
                            <h1 className="text-5xl md:text-7xl font-black tracking-tighter
                                           text-slate-900 dark:text-white
                                           leading-[0.92] font-display relative z-10">
                                Manage <br />
                                <span className="text-ember-500">Projects.</span>
                            </h1>
                        </div>

                        <p className="text-lg text-slate-500 dark:text-slate-500 font-medium max-w-xl mt-1 leading-relaxed">
                            Connected repositories and local directories. Monitor health, tasks, and sprint activity.
                        </p>
                    </div>

                    {/* Header right */}
                    <div className="flex flex-col items-end gap-4 shrink-0">
                        {/* Status pills */}
                        <div className="flex items-center gap-2.5">
                            {runningCount > 0 && (
                                <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] rounded-full
                                               bg-status-green/[0.08] text-status-green
                                               border border-status-green/20
                                               flex items-center gap-2
                                               shadow-[0_0_16px_rgba(0,171,132,0.08)]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-status-green relative">
                                        <span className="absolute inset-0 rounded-full animate-ping bg-status-green opacity-70" />
                                    </span>
                                    {runningCount} Running
                                </div>
                            )}
                            <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] rounded-full
                                           bg-black/[0.04] dark:bg-white/[0.04] text-slate-500
                                           border border-black/[0.06] dark:border-white/[0.06]
                                           flex items-center gap-2">
                                <FolderOpen className="w-3 h-3" strokeWidth={2} />
                                {sources.length} Total
                            </div>
                        </div>

                        {/* CTA */}
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => {
                                    setModalSourceType('new_project');
                                    setShowModal(true);
                                }}
                                className="flex items-center gap-2 px-4 py-2 bg-ember-500 hover:bg-ember-400 text-void-900 font-bold text-sm rounded-2xl transition-all active:scale-95 shadow-[0_4px_20px_rgba(255,184,0,0.25)] hover:shadow-[0_8px_32px_rgba(255,184,0,0.4)] focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500"
                            >
                                <Sparkles className="w-4 h-4" />
                                New Project
                            </button>
                        </div>
                    </div>
                </div>

                {/* ── Filter Tab Strip ────────────────────────────────── */}
                <div className="-mt-4 flex gap-1 p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl w-fit">
                    {(['All', 'Running', 'Idle', 'Failed'] as Filter[]).map(f => (
                        <button
                            key={f}
                            onClick={() => setActiveFilter(f)}
                            className={`text-xs font-semibold tracking-wide px-4 py-1.5 rounded-lg transition-all duration-200 flex items-center gap-2
                                ${activeFilter === f
                                    ? 'bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]'
                                    : 'text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                }`}
                        >
                            {f}
                            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-md
                                ${activeFilter === f
                                    ? 'bg-ember-500/[0.12] text-ember-600 dark:text-ember-400'
                                    : 'bg-black/[0.06] dark:bg-white/[0.06] text-slate-400'
                                }`}>
                                {counts[f]}
                            </span>
                        </button>
                    ))}
                </div>

                {/* ── Cards Grid ──────────────────────────────────────── */}
                <div ref={gridRef} className="grid grid-cols-1 grid-rows-1 relative">
                    <SkeletonLoader
                        show={showSkeletons}
                        className="col-start-1 row-start-1"
                        skeleton={(
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                                <SkeletonPanel />
                                <SkeletonPanel />
                                <SkeletonPanel />
                                <SkeletonPanel />
                            </div>
                        )}
                    >
                    {!loading ? (
                        <div className="col-start-1 row-start-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                            {filtered.map(source => (
                                <div key={source.id} className="project-card-entry h-full">
                                    <ProjectCard
                                        source={source}
                                        isSelected={selectedProjectId === source.id}
                                        isSettingUp={runningSetupProjectIds.has(source.id)}
                                        setupInvocationId={setupInvocationByProjectId[source.id] || null}
                                        onSelect={() => { void selectProject(source.id); }}
                                        onDelete={() => { void deleteProject(source.id); }}
                                        onSetup={() => {
                                            setSetupProjectId(source.id);
                                            setSetupOptions({ agents: true, quicksprints: true, previewScript: true, ci: true });
                                            setSetupError(null);
                                        }}
                                        onOpenInvocation={() => {
                                            const invocationId = setupInvocationByProjectId[source.id];
                                            if (invocationId) {
                                                openInvocation(invocationId);
                                            }
                                        }}
                                        onSettings={() => openProjectSettings(source.id)}
                                    />
                                </div>
                            ))}
                            <div className="project-card-entry h-full">
                                <AddCard onClick={() => {
                                    setModalSourceType('local');
                                    setShowModal(true);
                                }} />
                            </div>
                        </div>
                    ) : null}
                    </SkeletonLoader>
                </div>
            </PageContainer>

            {showModal && (
                <AddProjectModal
                    onClose={() => setShowModal(false)}
                    onAdd={handleAddProject}
                    initialSourceType={modalSourceType}
                />
            )}
            {activeSetupProject && (
                <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/55 px-6 backdrop-blur-xl" role="dialog" aria-modal="true" aria-labelledby="setup-project-title">
                    <div className="w-full max-w-xl rounded-[2rem] border border-black/[0.06] bg-white p-6 shadow-[0_40px_90px_rgba(0,0,0,0.28)] dark:border-white/[0.08] dark:bg-void-800">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-ember-500">
                                    <Bot className="h-4 w-4" />
                                    Project Setup Agent
                                </div>
                                <h2 id="setup-project-title" className="mt-3 font-display text-3xl font-black tracking-tight text-slate-900 dark:text-white">
                                    Setup {activeSetupProject.name}
                                </h2>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSetupProjectId(null)}
                                disabled={isActiveSetupRunning}
                                className="rounded-full bg-black/[0.05] px-3 py-2 text-xs font-bold text-slate-500 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:text-white"
                            >
                                Close
                            </button>
                        </div>
                        <div className="mt-5 grid gap-2 sm:grid-cols-2">
                            {([
                                { key: "agents", label: "Agents", description: "Specialists and routing." },
                                { key: "quicksprints", label: "Quicksprints", description: "Sprint templates." },
                                { key: "previewScript", label: "Preview Script", description: "Container startup." },
                                { key: "ci", label: "CI", description: "Basic checks." },
                            ] as const).map((option) => (
                                <button
                                    key={option.key}
                                    type="button"
                                    onClick={() => setSetupOptions(prev => ({ ...prev, [option.key]: !prev[option.key] }))}
                                    disabled={isActiveSetupRunning}
                                    className={`rounded-2xl border p-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                                        setupOptions[option.key]
                                            ? "border-ember-500/35 bg-ember-500/[0.08] text-slate-900 dark:text-white"
                                            : "border-black/[0.06] bg-black/[0.025] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-400"
                                    }`}
                                    aria-pressed={setupOptions[option.key]}
                                >
                                    <span className="block text-xs font-black uppercase tracking-[0.14em]">{option.label}</span>
                                    <span className="mt-1 block text-xs font-medium opacity-75">{option.description}</span>
                                </button>
                            ))}
                        </div>
                        {setupError && (
                            <div className="mt-4 rounded-2xl bg-status-red/[0.08] p-3 text-sm font-semibold text-status-red" role="alert">
                                {setupError}
                            </div>
                        )}
                        <div className="mt-6 flex items-center justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setSetupProjectId(null)}
                                disabled={isActiveSetupRunning}
                                className="rounded-2xl px-4 py-3 text-sm font-bold text-slate-500 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-white"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => { void handleRunSetup(); }}
                                disabled={isActiveSetupRunning}
                                className="flex items-center gap-2 rounded-2xl bg-ember-500 px-5 py-3 text-sm font-black text-void-900 shadow-[0_4px_20px_rgba(255,184,0,0.24)] transition-all hover:bg-ember-400 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                            >
                                {isActiveSetupRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                                {isActiveSetupRunning ? "Setting up..." : "Setup Project"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
