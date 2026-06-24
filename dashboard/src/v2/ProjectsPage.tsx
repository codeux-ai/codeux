import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Bot, FolderOpen, Plus, ExternalLink, Loader2, Trash2, Sparkles } from "lucide-preact";
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

const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
};

/* ─── Project Card ──────────────────────────────────────────────────────── */

const ProjectCard: FunctionComponent<{
    source: Source;
    isSelected: boolean;
    isSettingUp: boolean;
    setupInvocationId?: string | null;
    onSelect: () => void;
    onDelete: () => void;
    onSetup: () => void;
    onOpenInvocation: () => void;
}> = ({ source, isSelected, isSettingUp, setupInvocationId, onSelect, onDelete, onSetup, onOpenInvocation }) => {
    const cardRef  = useRef<HTMLDivElement>(null);
    const label    = statusLabel[source.status];
    const color    = statusColor[source.status];
    const isRunning = source.status === 'running';
    const accentHex = '#00AB84';
    const watermark = source.name.slice(0, 3).toUpperCase();
    const total     = source.completedTasks + source.openTasks;
    const completion = total > 0 ? Math.round((source.completedTasks / total) * 100) : 0;

    const onEnter = () => {
        if (!cardRef.current) return;
        gsap.to(cardRef.current, {
            y: -6,
            scale: 1.022,
            duration: 0.5,
            ease: "back.out(2)",
            overwrite: "auto",
        });
    };

    const onLeave = () => {
        if (!cardRef.current) return;
        gsap.to(cardRef.current, {
            y: 0,
            scale: 1,
            duration: 0.8,
            ease: "elastic.out(1, 0.5)",
            overwrite: "auto",
        });
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
            onClick={onSelect}
            onMouseEnter={onEnter}
            onMouseLeave={onLeave}
            className="group relative"
        >
          {/* Running project: stable layered breathing glow aura */}
          {isRunning && (
            <div
              className="absolute inset-0 rounded-[1.75rem] pointer-events-none scale-[1.012]"
              style={{ zIndex: 0 }}
            >
              {/* Crisp accent border */}
              <div
                className="absolute inset-0 rounded-[1.75rem]"
                style={{ border: `1px solid ${accentHex}70` }}
              />
              {/* Ambient breathing glow */}
              <div
                className="absolute inset-0 rounded-[1.75rem] animate-[pulse_3.5s_ease-in-out_infinite]"
                style={{ boxShadow: `0 0 20px ${accentHex}40, inset 0 0 10px ${accentHex}20` }}
              />
            </div>
          )}
          <div
            className={`relative flex flex-col
                       backdrop-blur-2xl
                       rounded-[1.75rem]
                       p-7
                       overflow-hidden cursor-pointer
                       ${isRunning ? "bg-white/72 dark:bg-void-800/82" : "bg-white/70 dark:bg-void-800/60"}
                       ${isSelected
                         ? "border border-ember-500/45 shadow-[0_8px_30px_rgba(255,184,0,0.08)] ring-1 ring-ember-500/18"
                         : "border border-black/[0.06] dark:border-white/[0.06] shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]"
                       }`}
          >
            {/* Ghost watermark */}
            <div
                aria-hidden="true"
                className="absolute -bottom-5 -right-2 text-[7rem] font-black tracking-tighter
                           text-black/[0.03] dark:text-white/[0.025]
                           pointer-events-none select-none font-display leading-none"
            >
                {watermark}
            </div>

            {/* Hover tint */}
            <div className="absolute inset-0 bg-signal-500/0 group-hover:bg-signal-500/[0.03] dark:group-hover:bg-signal-500/[0.05] transition-colors duration-300 pointer-events-none" />

            {/* Wave + border trace */}
            <WaveFluid accentHex={EMBER_HEX} />
            <BorderTrace accentHex={EMBER_HEX} />

            {/* ── Header ────────────────────────────────────────────── */}
            <div className="flex items-start justify-between mb-6 relative z-10">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-2xl bg-ember-500/[0.08] dark:bg-ember-500/[0.1] flex items-center justify-center group-hover:bg-ember-500/[0.18] transition-colors duration-300 shrink-0">
                        <FolderOpen className="w-5 h-5 text-ember-600 dark:text-ember-400" strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0">
                        <h3 className="font-bold text-[15px] text-slate-900 dark:text-white tracking-tight truncate leading-snug">
                            {source.name}
                        </h3>
                        <span className="text-[9px] font-mono text-slate-400 uppercase tracking-[0.14em]">{source.id}</span>
                    </div>
                </div>

                <div className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] shrink-0 ml-3 ${color}`}>
                    <StatusDot status={source.status} />
                    {label}
                </div>
            </div>

            {isSettingUp && (
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        if (setupInvocationId) {
                            onOpenInvocation();
                        }
                    }}
                    className="relative z-10 mb-4 flex w-full items-center justify-between rounded-2xl border border-ember-500/25 bg-ember-500/[0.08] px-3 py-2 text-left text-ember-700 transition-colors hover:bg-ember-500/[0.12] dark:text-ember-300"
                    disabled={!setupInvocationId}
                    title={setupInvocationId ? "Open setup invocation" : "Invocation starting"}
                >
                    <span className="flex min-w-0 items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                        <span className="truncate text-[10px] font-black uppercase tracking-[0.14em]">
                            Initializing
                        </span>
                    </span>
                    <span className="ml-2 shrink-0 font-mono text-[9px] font-bold opacity-80">
                        {setupInvocationId ? setupInvocationId.slice(0, 8) : "starting"}
                    </span>
                </button>
            )}

            {/* ── Stats ─────────────────────────────────────────────── */}
            <div className="grid grid-cols-3 gap-2 mb-6 relative z-10">
                {([
                    { label: 'Sprints', value: source.sprintsCount },
                    { label: 'Open',    value: source.openTasks     },
                    { label: 'Done',    value: source.completedTasks },
                ] as const).map(({ label: l, value }) => (
                    <div
                        key={l}
                        className="flex flex-col items-center py-3.5 rounded-[1rem]
                                   bg-black/[0.03] dark:bg-white/[0.03]
                                   border border-black/[0.04] dark:border-white/[0.04]
                                   group-hover:border-ember-500/[0.08] transition-colors duration-300"
                    >
                        <span className="text-[1.6rem] font-black text-slate-900 dark:text-white font-mono leading-none">
                            {value}
                        </span>
                        <span className="text-[8px] font-bold uppercase tracking-[0.16em] text-slate-400 mt-1.5">
                            {l}
                        </span>
                    </div>
                ))}
            </div>

            {/* ── Progress bar ──────────────────────────────────────── */}
            <div className="mb-6 relative z-10">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Completion</span>
                    <span className="text-[10px] font-mono font-bold text-slate-600 dark:text-slate-400">{completion}%</span>
                </div>
                <div className="h-1.5 w-full bg-black/[0.05] dark:bg-white/[0.05] rounded-full overflow-hidden">
                    <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                            width: `${completion}%`,
                            background: 'linear-gradient(90deg, #FFB800, #FFD080)',
                            boxShadow: completion > 0 ? '0 0 10px rgba(255,184,0,0.45)' : 'none',
                        }}
                    />
                </div>
            </div>

            {/* ── Footer ────────────────────────────────────────────── */}
            <div className="flex items-center justify-between relative z-10 mt-auto">
                <span className="text-[9px] font-mono text-slate-400 dark:text-slate-600">
                    {timeAgo(source.updatedAt)}
                </span>

                {/* Actions — slide up on hover */}
                <div
                    className="flex items-center gap-1
                               opacity-0 group-hover:opacity-100
                               translate-y-1.5 group-hover:translate-y-0
                               transition-[opacity,transform] duration-300"
                >
                    <button className="w-7 h-7 flex items-center justify-center rounded-xl
                                       bg-black/[0.04] dark:bg-white/[0.04]
                                       hover:bg-black/[0.08] dark:hover:bg-white/[0.08]
                                       text-slate-400 hover:text-slate-900 dark:hover:text-white
                                       transition-colors duration-200"
                            onClick={(event) => {
                                event.stopPropagation();
                                onSelect();
                            }}>
                        <ExternalLink className="w-3 h-3" strokeWidth={2} />
                    </button>
                    <button className="w-7 h-7 flex items-center justify-center rounded-xl
                                       bg-black/[0.04] dark:bg-white/[0.04]
                                       hover:bg-black/[0.08] dark:hover:bg-white/[0.08]
                                       text-slate-400 hover:text-slate-900 dark:hover:text-white
                                       transition-colors duration-200"
                            onClick={(event) => {
                                event.stopPropagation();
                                onSetup();
                            }}>
                        <Bot className="w-3 h-3" strokeWidth={2} />
                    </button>
                    <button className="w-7 h-7 flex items-center justify-center rounded-xl
                                       bg-black/[0.04] dark:bg-white/[0.04]
                                       hover:bg-status-red/[0.1]
                                       text-slate-400 hover:text-status-red
                                       transition-colors duration-200"
                            onClick={(event) => {
                                event.stopPropagation();
                                onDelete();
                            }}>
                        <Trash2 className="w-3 h-3" strokeWidth={2} />
                    </button>
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
                   border-2 border-dashed border-signal-500/25 hover:border-signal-500/50
                   rounded-[1.75rem]
                   shadow-[0_2px_20px_rgba(0,0,0,0.03)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.18)]
                   transition-colors duration-500
                   hover:bg-signal-500/[0.025] cursor-pointer"
    >
        {/* Morphing organic icon */}
        <div
            className="relative w-16 h-16 flex items-center justify-center
                       border-2 border-dashed border-signal-500/25
                       group-hover:border-signal-500 group-hover:bg-signal-500/[0.1]
                       transition-all duration-400 animate-organic"
        >
            <div
                className="absolute inset-0 bg-signal-500/0 group-hover:bg-signal-500/[0.08]
                           transition-colors duration-300 animate-organic-reverse"
            />
            <Plus
                className="w-6 h-6 text-signal-500/40 group-hover:text-signal-500
                           group-hover:rotate-90 transition-all duration-400 relative z-10"
                strokeWidth={2}
            />
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
            await createProject({
                name: project.name,
                sourceType: project.initMode === 'new-local' ? 'local' : 'git',
                sourceRef: project.initMode === 'new-local'
                    ? (project.path || project.repoSlug || project.name)
                    : (project.repoSlug || project.name),
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
