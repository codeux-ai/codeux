import type { FunctionComponent, JSX } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { useNavigate } from "@tanstack/react-router";
import {
    Bot,
    Check,
    Circle,
    Clock3,
    FolderOpen,
    GitBranch,
    Globe,
    Link,
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
import { buildProjectCardViewModel } from "./lib/project-card-view-model.js";

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

// Vertical status spine running down the card's left edge.
const statusSpine: Record<SourceStatus, string> = {
    running:      'bg-status-green',
    failed:       'bg-status-red',
    intervention: 'bg-status-amber',
    idle:         'bg-slate-300 dark:bg-white/15',
};


type ProjectMetaIcon = any;

/* ─── Project Card ──────────────────────────────────────────────────────── */

/** One manifest row — label, dotted leader, value (editorial / invoice aesthetic). */
const MetaRow: FunctionComponent<{
    icon: ProjectMetaIcon;
    label: string;
    value: string;
    isEmpty: boolean;
    mono?: boolean;
}> = ({ icon: Icon, label, value, isEmpty, mono }) => (
    <div className="flex items-baseline gap-2 min-w-0">
        <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
            <Icon className="h-3 w-3 shrink-0 -translate-y-px" strokeWidth={2.4} aria-hidden="true" />
            {label}
        </span>
        <span aria-hidden="true" className="-translate-y-[3px] flex-1 border-b border-dotted border-black/[0.14] dark:border-white/[0.14]" />
        <span
            title={isEmpty ? undefined : value}
            className={`min-w-0 max-w-[58%] shrink truncate text-[12px] leading-snug ${mono ? "font-mono" : "font-semibold"} ${
                isEmpty ? "italic text-slate-300 dark:text-slate-600" : "text-slate-800 dark:text-slate-100"
            }`}
        >
            {value}
        </span>
    </div>
);

/** A big editorial stat numeral (Sprints / Open / Done). */
const StatTile: FunctionComponent<{ label: string; value: number; accent?: boolean }> = ({ label, value, accent }) => (
    <div className="flex flex-col items-center justify-center gap-1 py-0.5">
        <div className={`font-display text-2xl font-black tabular-nums leading-none ${accent ? "bg-gradient-to-br from-ember-500 to-signal-500 bg-clip-text text-transparent" : "text-slate-900 dark:text-white"}`}>
            {value}
        </div>
        <div className="text-[8px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
            {label}
        </div>
    </div>
);

/** Compact secondary action — icon-only, used for the card action toolbar. */
const IconAction: FunctionComponent<{
    icon: ProjectMetaIcon;
    label: string;
    onClick: () => void;
    danger?: boolean;
    busy?: boolean;
    disabled?: boolean;
    onHover?: () => void;
}> = ({ icon: Icon, label, onClick, danger, busy, disabled, onHover }) => (
    <button
        type="button"
        onClick={(event) => {
            event.stopPropagation();
            if (disabled) return;
            onClick();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseEnter={(event) => { event.stopPropagation(); onHover?.(); }}
        onFocus={(event) => { event.stopPropagation(); onHover?.(); }}
        disabled={disabled}
        aria-label={label}
        aria-busy={busy}
        title={label}
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-500/30 ${
            danger
                ? "border-status-red/15 bg-status-red/[0.05] text-status-red/80 hover:border-status-red/30 hover:bg-status-red/[0.12] hover:text-status-red"
                : "border-black/[0.06] bg-white/60 text-slate-500 hover:bg-black/[0.05] hover:text-slate-900 dark:border-white/[0.07] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
        } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
    </button>
);

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

    // Repository URL (git projects) and on-disk workspace path (shown for every project).
    const hasRepoUrl = !viewModel.gitUrl.isEmpty;
    const pathValue = viewModel.localDirectory.isEmpty ? "Not set" : viewModel.localDirectory.value;
    const branchValue = viewModel.branch.isEmpty ? "Not set" : viewModel.branch.value;
    const hostValue = viewModel.hostLabel.isEmpty ? viewModel.providerLabel.value : viewModel.hostLabel.value;
    const hostIsEmpty = viewModel.hostLabel.isEmpty && viewModel.providerLabel.isEmpty;
    const lastRunValue = viewModel.lastRunAt.isEmpty ? "No runs yet" : viewModel.lastRunAt.value;
    const selectedLabel = isCardSelected ? "Selected project" : "Select project";

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
                        ? "border-ember-500/45 bg-white/80 shadow-[0_14px_44px_rgba(255,184,0,0.12)] ring-1 ring-ember-500/25 dark:bg-void-800/80"
                        : "border-black/[0.06] bg-white/72 shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:border-white/[0.06] dark:bg-void-800/64 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]"
                }`}
            >
                {/* Status spine — left edge, status-encoded */}
                <div
                    aria-hidden="true"
                    className={`pointer-events-none absolute left-0 top-0 z-20 h-full w-[3px] ${statusSpine[source.status]} ${isRunning ? "animate-pulse" : ""}`}
                />
                <div className="absolute inset-0 bg-signal-500/[0.025] opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100" />
                {/* Corner wash — status-green while running, else a soft warm amber */}
                <div className={`pointer-events-none absolute -top-16 -left-10 h-40 w-40 rounded-full blur-3xl opacity-40 ${
                    isRunning ? "bg-status-green/20" : "bg-ember-500/10"
                }`} />
                {/* Oversized editorial monogram watermark */}
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -bottom-10 -right-3 select-none font-display text-[7rem] font-black leading-none tracking-tighter text-black/[0.035] dark:text-white/[0.03]"
                >
                    {source.name.slice(0, 2).toUpperCase()}
                </div>
                <WaveFluid accentHex={EMBER_HEX} />
                <BorderTrace accentHex={EMBER_HEX} />

                <div className="relative z-10 flex flex-1 flex-col gap-4 p-5 pl-6">
                    {/* Top line — status + source kind */}
                    <div className="flex items-center justify-between gap-3">
                        <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${statusClass}`}>
                            <StatusDot status={source.status} />
                            <span>{statusText}</span>
                        </span>
                        <div className="flex items-center gap-2">
                            {isCardSelected ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-ember-500/[0.14] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-ember-700 dark:text-ember-200">
                                    <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden={true} />
                                    Selected
                                </span>
                            ) : null}
                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${
                                viewModel.sourceBadge.kind === "remote-git"
                                    ? "border-status-green/20 bg-status-green/[0.08] text-status-green"
                                    : viewModel.sourceBadge.kind === "local-repository"
                                        ? "border-signal-500/20 bg-signal-500/[0.1] text-signal-700 dark:text-signal-300"
                                        : "border-black/[0.07] bg-black/[0.03] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300"
                            }`}>
                                {viewModel.sourceBadge.label}
                            </span>
                        </div>
                    </div>

                    {/* Identity — monogram + name */}
                    <div className="flex items-center gap-3.5">
                        <div
                            aria-hidden="true"
                            className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl border border-ember-500/20 bg-gradient-to-br from-ember-500/[0.16] to-ember-600/[0.08] font-display text-xl font-black text-ember-700 dark:border-ember-400/15 dark:text-ember-200"
                        >
                            <span className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,184,0,0.12)_0%,transparent_55%)]" />
                            <span className="relative">{source.name.slice(0, 1).toUpperCase()}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                            <h3 className="line-clamp-2 font-display text-lg font-black leading-tight tracking-tight text-slate-900 dark:text-white">
                                {source.name}
                            </h3>
                            <div className="mt-0.5 truncate font-mono text-[10px] tracking-wide text-slate-400 dark:text-slate-500">
                                {source.id}
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
                            className="flex items-center justify-between rounded-xl border border-ember-500/25 bg-ember-500/[0.08] px-3 py-2.5 text-left text-ember-700 transition-colors hover:bg-ember-500/[0.12] dark:text-ember-200"
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

                    {/* Manifest — repo URL, workspace path, target branch, host, last run */}
                    <div className="flex flex-col gap-2 border-t border-black/[0.06] pt-3.5 dark:border-white/[0.07]">
                        {hasRepoUrl ? (
                            <MetaRow icon={Link} label="Repo" value={viewModel.gitUrl.value} isEmpty={false} mono />
                        ) : null}
                        <MetaRow icon={MapPin} label="Path" value={pathValue} isEmpty={viewModel.localDirectory.isEmpty} mono />
                        <MetaRow icon={GitBranch} label="Branch" value={branchValue} isEmpty={viewModel.branch.isEmpty} mono />
                        <MetaRow icon={Globe} label="Host" value={hostValue} isEmpty={hostIsEmpty} />
                        <MetaRow icon={Clock3} label="Last run" value={lastRunValue} isEmpty={viewModel.lastRunAt.isEmpty} />
                    </div>

                    {/* Stats band */}
                    <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] divide-x divide-black/[0.06] border-y border-black/[0.06] py-2 dark:divide-white/[0.07] dark:border-white/[0.07]">
                        <StatTile label="Sprints" value={source.sprintsCount} />
                        <StatTile label="Open" value={source.openTasks} />
                        <StatTile label="Done" value={source.completedTasks} accent={completion === 100 && totalTasks > 0} />
                    </div>

                    {/* Completion meter */}
                    <div>
                        <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                            <span>Completion</span>
                            <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">{completion}%</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
                            <div
                                className="h-full rounded-full bg-gradient-to-r from-ember-500 via-ember-400 to-signal-500 shadow-[0_0_10px_rgba(255,184,0,0.4)] transition-[width] duration-700"
                                style={{ width: `${completion}%` }}
                            />
                        </div>
                    </div>

                    {/* Actions — select toggle + compact icon toolbar */}
                    <div className="mt-auto flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); onSelect(); }}
                            onPointerDown={(event) => event.stopPropagation()}
                            aria-pressed={isCardSelected}
                            aria-label={isCardSelected ? `${source.name} is selected` : `Select ${source.name}`}
                            className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold tracking-wide transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-500/40 ${
                                isCardSelected
                                    ? "bg-ember-500 text-void-900 shadow-[0_4px_18px_rgba(255,184,0,0.3)] hover:bg-ember-400"
                                    : "border border-black/[0.1] bg-white/50 text-slate-700 hover:border-ember-500/45 hover:bg-ember-500/[0.08] hover:text-ember-700 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-slate-200 dark:hover:border-ember-500/45 dark:hover:text-ember-200"
                            }`}
                        >
                            {isCardSelected
                                ? <Check className="h-4 w-4" strokeWidth={2.6} aria-hidden="true" />
                                : <Circle className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden="true" />}
                            {isCardSelected ? "Selected" : "Select project"}
                        </button>
                        <IconAction
                            icon={Bot}
                            label={isSettingUp ? "Project setup is already running" : "Setup project"}
                            onClick={onSetup}
                            busy={isSettingUp}
                            disabled={isSettingUp}
                        />
                        <IconAction
                            icon={Settings}
                            label="Project settings"
                            onClick={onSettings}
                            onHover={() => prefetchRoute("/config")}
                        />
                        <IconAction
                            icon={Trash2}
                            label="Delete project"
                            onClick={onDelete}
                            danger
                        />
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
        className="group relative flex h-full min-h-[300px] w-full flex-col items-center justify-center gap-5
                   overflow-hidden p-7
                   bg-white/45 dark:bg-void-800/35
                   backdrop-blur-2xl
                   border border-dashed border-black/[0.12] dark:border-white/[0.12] hover:border-ember-500/50
                   rounded-[1.75rem]
                   shadow-[0_2px_20px_rgba(0,0,0,0.03)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.18)]
                   transition-all duration-500
                   hover:bg-ember-500/[0.03] cursor-pointer"
    >
        {/* Ghost watermark + corner wash to echo the project cards */}
        <span aria-hidden="true" className="pointer-events-none absolute -top-14 -left-8 h-36 w-36 rounded-full bg-ember-500/10 blur-3xl opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-10 -right-3 select-none font-display text-[7rem] font-black leading-none tracking-tighter text-black/[0.03] dark:text-white/[0.025]">
            +
        </span>

        <div className="relative grid h-14 w-14 place-items-center rounded-2xl border border-black/[0.06] bg-black/[0.02] transition-all duration-300 group-hover:scale-110 group-hover:border-ember-500/30 group-hover:bg-ember-500/[0.12] dark:border-white/[0.06] dark:bg-white/[0.02]">
            <Plus className="h-6 w-6 text-slate-400 transition-colors duration-300 group-hover:text-ember-500" strokeWidth={2.2} />
        </div>

        <div className="relative flex flex-col items-center gap-1.5">
            <span className="font-display text-sm font-black uppercase tracking-[0.18em]
                             text-slate-400 dark:text-slate-500
                             group-hover:text-ember-600 dark:group-hover:text-ember-300 transition-colors duration-300">
                Add Project
            </span>
            <span className="text-[9px] font-mono uppercase tracking-[0.16em] text-slate-300 dark:text-slate-600
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
            <PageContainer aria-label="Projects" containerRef={mainRef} className="gap-10">
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
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 md:gap-8">
                    <div className="flex flex-col gap-3">
                        {/* Eyebrow */}
                        <div className="flex items-center gap-2.5 text-ember-500 font-bold tracking-[0.2em] uppercase text-[10px] font-mono">
                            <FolderOpen className="w-3.5 h-3.5" strokeWidth={2.5} />
                            Source Repositories
                        </div>

                        {/* Hero headline */}
                        <h1 className="text-3xl md:text-4xl font-black tracking-tighter
                                       text-slate-900 dark:text-white
                                       leading-[1.05] font-display">
                            Manage <span className="text-ember-500">Projects.</span>
                        </h1>

                        <p className="text-sm text-slate-500 dark:text-slate-500 font-medium max-w-md leading-relaxed">
                            Connected repositories and local directories. Monitor health, tasks, and sprint activity.
                        </p>
                    </div>

                    {/* Header right */}
                    <div className="flex flex-col sm:flex-row md:flex-col items-start sm:items-center md:items-end gap-4 shrink-0">
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
                <div className="flex flex-wrap gap-1 p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl w-fit">
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
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5">
                                <SkeletonPanel />
                                <SkeletonPanel />
                                <SkeletonPanel />
                                <SkeletonPanel />
                            </div>
                        )}
                    >
                    {!loading ? (
                        <div className="col-start-1 row-start-1 grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
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
                    <div className="flex flex-col max-h-[calc(100vh-2rem)] w-full max-w-xl rounded-[2rem] border border-black/[0.06] bg-white p-4 sm:p-6 shadow-[0_40px_90px_rgba(0,0,0,0.28)] dark:border-white/[0.08] dark:bg-void-800">
                        <div className="overflow-y-auto pr-2 -mr-2">
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
                        </div>
                        <div className="mt-6 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 shrink-0 pt-2 border-t border-black/[0.06] dark:border-white/[0.08]">
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
                                className="flex items-center justify-center gap-2 rounded-2xl bg-ember-500 px-5 py-3 text-sm font-black text-void-900 shadow-[0_4px_20px_rgba(255,184,0,0.24)] transition-all hover:bg-ember-400 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
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
