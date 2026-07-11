import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Bot, Plus, Info, ShieldCheck, AlertTriangle, Database, FileText, CheckCircle2, GitBranch, Loader2, ExternalLink } from "lucide-preact";
import type { AgentPreset, SkillStorageRecord } from "./types.js";
import type { InstructionFileSummary, InstructionFileContent } from "./lib/instruction-file-api.js";
import { fetchInstructionFiles } from "./lib/instruction-file-api.js";
import { useProjectData } from "./context/project-data.js";
import {
  createAgentPreset,
  deleteAgentPreset,
  exportAgentPresetToMarkdown,
  fetchAgentPresets,
  fetchSkillStorages,
  importAgentPresetFromMarkdown,
  pullAgentPresetsFromMarkdown,
  pushAgentPresetsToMarkdown,
  pushAgentPresetsToRepository,
  updateAgentPreset,
} from "./lib/agent-preset-api.js";
import { useProjectEffectiveSettings } from "./hooks/use-project-effective-settings.js";
import { generateRandomAgentAvatar } from "./lib/agent-avatar.js";
import { fetchProjectInvocationsQuery } from "./lib/invocation-api.js";
import { WaveFluid } from "./components/ui/WaveFluid.js";
import { BorderTrace } from "./components/ui/BorderTrace.js";
import { AgentsHero } from "./components/agents/AgentsHero.js";
import { AgentPresetShowcaseCard } from "./components/agents/AgentPresetShowcaseCard.js";
import { AgentPresetDetailPanel, type AgentUsageSummary } from "./components/agents/AgentPresetDetailPanel.js";
import { AgentPresetEditorPanel } from "./components/agents/AgentPresetEditorPanel.js";
import { InstructionFileCard } from "./components/agents/InstructionFileCard.js";
import { InstructionFileEditorPanel } from "./components/agents/InstructionFileEditorPanel.js";
import { PageContainer } from "./components/layout/PageContainer.js";
import { SectionDivider } from "./components/ui/SectionDivider.js";

/* ── Roster summary stat ── */
type RosterStatProps = {
  label: string;
  value: number;
  accent: "signal" | "amber" | "rose" | "slate";
  icon: typeof Bot;
};

const accentTone: Record<RosterStatProps["accent"], { dot: string; text: string; glow: string }> = {
  signal: { dot: "bg-signal-500", text: "text-signal-600 dark:text-signal-400", glow: "shadow-[0_0_10px_rgba(0,224,160,0.5)]" },
  amber: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", glow: "shadow-[0_0_10px_rgba(255,184,0,0.45)]" },
  rose: { dot: "bg-status-red", text: "text-status-red", glow: "shadow-[0_0_10px_rgba(211,47,47,0.45)]" },
  slate: { dot: "bg-slate-400 dark:bg-slate-500", text: "text-slate-600 dark:text-slate-300", glow: "" },
};

const RosterStat: FunctionComponent<RosterStatProps> = ({ label, value, accent, icon: Icon }) => {
  const tone = accentTone[accent];
  return (
    <div className="group relative overflow-hidden rounded-[1.6rem] border border-black/[0.06] bg-white/70 p-5 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(0,0,0,0.06)] dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
          {label}
        </span>
        <span className={`h-2 w-2 rounded-full ${tone.dot} ${tone.glow}`} />
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div className="font-display text-2xl font-semibold tracking-tighter text-slate-900 dark:text-white">
          {value}
        </div>
        <Icon className={`h-5 w-5 ${tone.text}`} strokeWidth={1.8} />
      </div>
    </div>
  );
};

const normalizeAgentName = (value: string): string => (
  value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLowerCase()
);

type QaRouteTriggerSettings = {
  enabled?: boolean;
  agentPresetIds?: unknown;
  agentPresetId?: string | null;
};

type PushAgentMode = "commit_only" | "commit_and_push" | "pull_request";

type PushAgentResult = {
  mode: PushAgentMode;
  committed: boolean;
  pushedBranch?: string;
  pullRequestUrl?: string;
};

type PageActionFeedback = {
  tone: "pending" | "success" | "error";
  message: string;
  retry?: () => void;
} | null;

/* ── Main Page ── */
export const AgentsPage: FunctionComponent = () => {
  const contentRef = useRef<HTMLElement>(null);
  const pushButtonRef = useRef<HTMLButtonElement>(null);
  const pushPickerRef = useRef<HTMLDivElement>(null);
  const { selectedProject, loading: projectLoading } = useProjectData();
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [pullingFromFiles, setPullingFromFiles] = useState(false);
  const [pushingToFiles, setPushingToFiles] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushPickerOpen, setPushPickerOpen] = useState(false);
  const [pushMode, setPushMode] = useState<PushAgentMode>("commit_only");
  const [pushBranchName, setPushBranchName] = useState("");
  const [pushResult, setPushResult] = useState<PushAgentResult | null>(null);
  const [actionFeedback, setActionFeedback] = useState<PageActionFeedback>(null);
  const [projectFileSavingEnabled, setProjectFileSavingEnabled] = useState(true);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [selectedAgentUsage, setSelectedAgentUsage] = useState<AgentUsageSummary | null>(null);
  const [selectedAgentUsageLoading, setSelectedAgentUsageLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [instructionFiles, setInstructionFiles] = useState<InstructionFileSummary[]>([]);
  const [skillStorages, setSkillStorages] = useState<SkillStorageRecord[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const {
    data: effectiveSettings,
    error: effectiveSettingsError,
  } = useProjectEffectiveSettings(selectedProject?.id || null);

  useEffect(() => {
    if (effectiveSettings) {
      setProjectFileSavingEnabled(effectiveSettings.settings.agents.saveToProjectDirectory);
    } else if (!selectedProject) {
      setProjectFileSavingEnabled(true);
    }
  }, [effectiveSettings, selectedProject]);

  useEffect(() => {
    setPushPickerOpen(false);
    setPushResult(null);
    setPushMode("commit_only");
    setPushBranchName("");
  }, [selectedProject?.id]);

  const refreshPresets = async (preferredSelectedPresetId = selectedPresetId): Promise<void> => {
    if (!selectedProject) {
      setPresets([]);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const nextPresets = await fetchAgentPresets(selectedProject.id);
      setPresets(nextPresets);
      if (!preferredSelectedPresetId && nextPresets.length > 0) {
        setSelectedPresetId(nextPresets[0].id);
      } else if (preferredSelectedPresetId && !nextPresets.find((p) => p.id === preferredSelectedPresetId)) {
        setSelectedPresetId(nextPresets.length > 0 ? nextPresets[0].id : null);
        setIsEditing(false);
      }
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  };

  const refreshInstructionFiles = async (): Promise<void> => {
    if (!selectedProject) {
      setInstructionFiles([]);
      return;
    }
    try {
      setInstructionFiles(await fetchInstructionFiles(selectedProject.id));
    } catch {
      setInstructionFiles([]);
    }
  };

  const refreshSkillStorages = async (): Promise<void> => {
    if (!selectedProject) {
      setSkillStorages([]);
      return;
    }
    try {
      setSkillStorages(await fetchSkillStorages(selectedProject.id));
    } catch {
      setSkillStorages([]);
    }
  };

  useEffect(() => {
    setSelectedFileId(null);
    void refreshPresets();
    void refreshInstructionFiles();
    void refreshSkillStorages();
  }, [selectedProject?.id]);

  const handleInstructionFileSaved = (updated: InstructionFileContent): void => {
    setInstructionFiles((cur) => cur.map((f) => (f.id === updated.id ? { ...f, ...updated } : f)));
  };

  const selectAgent = (presetId: string): void => {
    setSelectedPresetId(presetId);
    setSelectedFileId(null);
    setIsEditing(false);
  };

  const selectInstructionFile = (fileId: string): void => {
    setSelectedFileId(fileId);
    setIsEditing(false);
  };

  useLayoutEffect(() => {
    if (!contentRef.current) return;
    const el = contentRef.current;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        Array.from(el.children),
        { opacity: 0, y: 28 },
        { opacity: 1, y: 0, duration: 0.75, stagger: 0.08, ease: "power4.out" }
      );
    });
    return () => ctx.revert();
  }, []);

  useEffect(() => {
    if (!pushPickerOpen) return undefined;

    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (pushPickerRef.current?.contains(target) || pushButtonRef.current?.contains(target)) {
        return;
      }
      setPushPickerOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setPushPickerOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [pushPickerOpen]);

  const handleCreate = async (): Promise<void> => {
    if (!selectedProject) return;
    try {
      setActionFeedback({ tone: "pending", message: "Creating agent preset..." });
      const created = await createAgentPreset(selectedProject.id, {
        name: `Agent ${presets.length + 1}`,
        instructionMarkdown: "",
        labels: [],
        avatarConfig: generateRandomAgentAvatar(Date.now().toString()),
      });
      setPresets((cur) => [created, ...cur]);
      setSelectedPresetId(created.id);
      setIsEditing(true);
      setError(null);
      setActionFeedback({ tone: "success", message: "Agent preset created. Complete the required fields, then save." });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setActionFeedback({ tone: "error", message: `Agent creation failed: ${message}`, retry: () => void handleCreate() });
    }
  };

  const handleImport = async (presetId: string): Promise<void> => {
    setImportingId(presetId);
    setActionFeedback({ tone: "pending", message: "Importing preset from markdown..." });
    try {
      const updated = await importAgentPresetFromMarkdown(presetId);
      setPresets((cur) => cur.map((p) => (p.id === updated.id ? updated : p)));
      setError(null);
      setActionFeedback({ tone: "success", message: "Agent preset imported from markdown." });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setActionFeedback({ tone: "error", message: `Import failed: ${message}`, retry: () => void handleImport(presetId) });
    } finally {
      setImportingId(null);
    }
  };

  const handlePullFromFiles = async (): Promise<void> => {
    if (!selectedProject || !projectFileSavingEnabled) return;
    const preferredPresetId = selectedPresetId;
    setPullingFromFiles(true);
    setActionFeedback({ tone: "pending", message: "Pulling agent presets from project files..." });
    try {
      await pullAgentPresetsFromMarkdown(selectedProject.id);
      await refreshPresets(preferredPresetId);
      setError(null);
      setActionFeedback({ tone: "success", message: "Agent presets pulled from project files." });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setActionFeedback({ tone: "error", message: `Pull failed: ${message}`, retry: () => void handlePullFromFiles() });
    } finally {
      setPullingFromFiles(false);
    }
  };

  const handlePushToFiles = async (): Promise<void> => {
    if (!selectedProject || !projectFileSavingEnabled) return;
    const preferredPresetId = selectedPresetId;
    setPushingToFiles(true);
    setActionFeedback({ tone: "pending", message: "Pushing agent presets to project files..." });
    try {
      await pushAgentPresetsToMarkdown(selectedProject.id);
      await refreshPresets(preferredPresetId);
      setError(null);
      setActionFeedback({ tone: "success", message: "Agent presets pushed to project files." });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setActionFeedback({ tone: "error", message: `Push failed: ${message}`, retry: () => void handlePushToFiles() });
    } finally {
      setPushingToFiles(false);
    }
  };

  const handlePushPresetToFile = async (presetId: string): Promise<void> => {
    if (!projectFileSavingEnabled) return;
    const preferredPresetId = selectedPresetId;
    setExportingId(presetId);
    setActionFeedback({ tone: "pending", message: "Pushing agent preset to project file..." });
    try {
      await exportAgentPresetToMarkdown(presetId);
      await refreshPresets(preferredPresetId);
      setError(null);
      setActionFeedback({ tone: "success", message: "Agent preset pushed to project file." });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setActionFeedback({ tone: "error", message: `Push failed: ${message}`, retry: () => void handlePushPresetToFile(presetId) });
    } finally {
      setExportingId(null);
    }
  };

  const handlePushAgents = (): void => {
    if (!selectedProject || pushing) return;
    setError(null);
    setPushResult(null);
    setPushPickerOpen(true);
  };

  const submitPushAgents = async (): Promise<void> => {
    if (!selectedProject || pushing) return;
    setPushing(true);
    setPushPickerOpen(false);

    try {
      const result = await pushAgentPresetsToRepository(selectedProject.id, {
        mode: pushMode,
        branchName: pushBranchName.trim() || undefined,
      });

      if (pushMode === "commit_only") {
        setPushResult({
          mode: pushMode,
          committed: result.committed,
        });
        setError(null);
      } else if (pushMode === "commit_and_push") {
        if (!result.pushedBranch) {
          setPushResult(null);
          setError("Agent presets were committed locally, but no remote origin is configured for this repository.");
        } else {
          setPushResult({
            mode: pushMode,
            committed: result.committed,
            pushedBranch: result.pushedBranch,
          });
          setError(null);
        }
      } else if (!result.pullRequestUrl) {
        setPushResult(null);
        setError("Agent presets were committed locally, but no pull request URL was returned.");
      } else {
        setPushResult({
          mode: pushMode,
          committed: result.committed,
          pushedBranch: result.pushedBranch,
          pullRequestUrl: result.pullRequestUrl,
        });
        setError(null);
      }
    } catch (e) {
      setPushResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPushing(false);
    }
  };

  const handleSave = async (presetId: string, next: Parameters<typeof updateAgentPreset>[1]): Promise<void> => {
    setSavingId(presetId);
    setActionFeedback({ tone: "pending", message: "Saving agent preset..." });
    try {
      const updated = await updateAgentPreset(presetId, next);
      setPresets((cur) => cur.map((p) => (p.id === updated.id ? updated : p)));
      setIsEditing(false);
      setError(null);
      setActionFeedback({ tone: "success", message: "Agent preset saved." });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setActionFeedback({ tone: "error", message: `Save failed: ${message}`, retry: () => void handleSave(presetId, next) });
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (presetId: string): Promise<void> => {
    setDeletingId(presetId);
    setActionFeedback({ tone: "pending", message: "Deleting agent preset..." });
    try {
      await deleteAgentPreset(presetId);
      setPresets((cur) => {
        const next = cur.filter((p) => p.id !== presetId);
        if (selectedPresetId === presetId) {
          setSelectedPresetId(next.length > 0 ? next[0].id : null);
          setIsEditing(false);
        }
        return next;
      });
      setError(null);
      setActionFeedback({ tone: "success", message: "Agent preset deleted." });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setActionFeedback({ tone: "error", message: `Delete failed: ${message}`, retry: () => void handleDelete(presetId) });
    } finally {
      setDeletingId(null);
    }
  };

  const routeTagsByPresetId = useMemo(() => {
    const tags = new Map<string, string[]>();
    const add = (agentPresetId: string | null | undefined, label: string) => {
      if (!agentPresetId) return;
      const current = tags.get(agentPresetId) ?? [];
      if (!current.includes(label)) {
        tags.set(agentPresetId, [...current, label]);
      }
    };
    const addBuiltIn = (label: string, builtInName: string) => {
      const agentPresetId = presets.find((preset) => normalizeAgentName(preset.name) === normalizeAgentName(builtInName))?.id;
      add(agentPresetId, label);
    };
    const addManualRoute = (
      agentPresetId: string | null | undefined,
      label: string,
      builtInName: string,
    ) => {
      if (agentPresetId) {
        add(agentPresetId, label);
      } else {
        addBuiltIn(label, builtInName);
      }
    };
    const collectQaAgentPresetIds = (trigger: QaRouteTriggerSettings): string[] => {
      if (Array.isArray(trigger.agentPresetIds)) {
        return trigger.agentPresetIds
          .filter((agentPresetId): agentPresetId is string => typeof agentPresetId === "string")
          .map((agentPresetId) => agentPresetId.trim())
          .filter(Boolean);
      }
      const legacyAgentPresetId = trigger.agentPresetId?.trim();
      return legacyAgentPresetId ? [legacyAgentPresetId] : [];
    };
    const addQaRoute = (
      trigger: QaRouteTriggerSettings | null | undefined,
      label: string,
    ) => {
      if (!trigger?.enabled) return;
      const agentPresetIds = collectQaAgentPresetIds(trigger);
      if (agentPresetIds.length > 0) {
        for (const agentPresetId of agentPresetIds) {
          add(agentPresetId, label);
        }
      } else {
        addBuiltIn(label, "Quality assurance agent");
      }
    };

    const routing = effectiveSettings?.settings.agents.routing;
    const qa = effectiveSettings?.settings.agents.qualityAssurance;

    addManualRoute(routing?.planning.agentPresetId, "Planning", "Planning agent");

    if (routing?.taskCoding.mode === "ORCHESTRATOR") {
      for (const agentPresetId of routing.taskCoding.orchestratorAgentPresetIds) {
        add(agentPresetId, "Coding Roster");
      }
    } else {
      addManualRoute(routing?.taskCoding.agentPresetId, "Coding", "Worker");
    }

    addManualRoute(routing?.ciFix.agentPresetId, "CI Fix", "Worker");
    addManualRoute(routing?.mergeConflict.agentPresetId, "Merge Conflict", "Worker");
    addManualRoute(routing?.dashboardReply.agentPresetId, "Dashboard Reply", "Project manager");
    addManualRoute(routing?.clarificationReply.agentPresetId, "Clarification Reply", "Project manager");

    if (qa?.enabled) {
      addQaRoute(qa.taskCompletion, "QA Task");
      addQaRoute(qa.sprintCompletion, "QA Sprint");
      addQaRoute(qa.completedTaskWithoutPr, "QA No PR");
    }

    return tags;
  }, [effectiveSettings, presets]);

  const providerOptions = useMemo(() => (
    Object.entries(effectiveSettings?.settings.aiProvider.providers || {}).map(([providerConfigId, provider]) => ({
      value: providerConfigId,
      label: provider.name,
      provider: provider.provider,
      model: provider.model,
      enabled: provider.enabled,
    }))
  ), [effectiveSettings]);

  const availableMcpServers = effectiveSettings?.settings.customMcpServers ?? [];

  const selectedPreset = presets.find((p) => p.id === selectedPresetId);
  const selectedFile = instructionFiles.find((f) => f.id === selectedFileId);
  const selectedPresetRouteTags = selectedPreset ? routeTagsByPresetId.get(selectedPreset.id) ?? [] : [];
  const selectedPresetIsDashboardReplyAgent = selectedPresetRouteTags.includes("Dashboard Reply");

  useEffect(() => {
    if (!selectedProject || !selectedPreset || selectedFileId) {
      setSelectedAgentUsage(null);
      setSelectedAgentUsageLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setSelectedAgentUsageLoading(true);
    fetchProjectInvocationsQuery(selectedProject.id, {
      agentPresetId: selectedPreset.id,
      limit: 8,
      sortKey: "startedAt",
      sortDir: "desc",
    }, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setSelectedAgentUsage({
          invocationCount: result.summary.totalInvocations,
          completedCount: result.summary.completedCount,
          failedCount: result.summary.failedCount,
          runningCount: result.summary.runningCount,
          totalTokens: result.summary.totalTokens,
          totalCostCents: result.summary.totalCostCents,
        });
      })
      .catch((usageError) => {
        if (controller.signal.aborted) return;
        setSelectedAgentUsage(null);
        console.warn("Failed to load agent usage summary", usageError);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSelectedAgentUsageLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [selectedProject?.id, selectedPreset?.id, selectedFileId]);

  const rosterStats = useMemo(() => {
    const synced = presets.filter((p) => p.syncStatus === "synced").length;
    const drift = presets.filter((p) => p.syncStatus === "out_of_sync" || p.syncStatus === "missing_source").length;
    const local = presets.filter((p) => !p.syncStatus || p.syncStatus === "manual").length;
    return { total: presets.length, synced, drift, local };
  }, [presets]);

  const pushFeedback = useMemo(() => {
    if (!pushResult) return null;

    if (pushResult.mode === "commit_only") {
      return pushResult.committed
        ? "Agent presets were committed locally."
        : "No agent preset changes were available to commit.";
    }

    if (pushResult.mode === "commit_and_push") {
      return pushResult.pushedBranch ? `Pushed agent presets to ${pushResult.pushedBranch}.` : null;
    }

    return pushResult.pullRequestUrl ? (
      <>
        Opened a pull request at{" "}
        <a
          href={pushResult.pullRequestUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-status-green underline decoration-status-green/40 underline-offset-2 hover:decoration-status-green"
        >
          {pushResult.pullRequestUrl}
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.2} />
        </a>
        .
      </>
    ) : null;
  }, [pushResult]);

  return (
    <PageContainer aria-label="Agents" containerRef={contentRef} padding="agents" className="gap-10 md:gap-14">
      <AgentsHero
        selectedProject={selectedProject}
        projectLoading={projectLoading}
        loading={loading}
        pullingFromFiles={pullingFromFiles}
        pushingToFiles={pushingToFiles}
        fileSyncDisabled={!projectFileSavingEnabled}
        presets={presets}
        extraActions={
          <div className="relative">
            <button
              ref={pushButtonRef}
              type="button"
              onClick={handlePushAgents}
              disabled={!selectedProject || pushing}
              className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600 backdrop-blur-md transition-all hover:bg-white hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white/70 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white disabled:dark:hover:bg-white/[0.03] disabled:dark:hover:text-slate-300"
            >
              {pushing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.3} />
              ) : (
                <GitBranch className="h-3.5 w-3.5" strokeWidth={2.3} />
              )}
              {pushing ? "Pushing..." : "Push Agents"}
            </button>

            {pushPickerOpen && (
              <div
                ref={pushPickerRef}
                role="dialog"
                aria-label="Push Agents"
                className="absolute right-0 top-full z-20 mt-3 w-[min(92vw,24rem)] rounded-2xl border border-black/[0.08] bg-white/95 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.14)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-void-800/95 dark:shadow-[0_16px_36px_rgba(0,0,0,0.4)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-500">
                      Push Agents
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                      Choose where to send the current .code-ux/agents changes.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPushPickerOpen(false)}
                    className="rounded-full border border-black/[0.06] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:bg-black/[0.03] hover:text-slate-800 dark:border-white/[0.08] dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-white"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-4 space-y-2">
                  {([
                    { value: "commit_only", label: "Commit locally", description: "Create a local commit only." },
                    { value: "commit_and_push", label: "Push to branch", description: "Commit, then push the branch to origin." },
                    { value: "pull_request", label: "Open pull request", description: "Commit, push, and open a PR." },
                  ] as const).map((option) => (
                    <label
                      key={option.value}
                      className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-3 py-3 transition-colors ${
                        pushMode === option.value
                          ? "border-signal-500/30 bg-signal-500/[0.08] text-white dark:bg-signal-500/10 dark:text-white"
                          : "border-black/[0.06] bg-white/70 text-slate-600 hover:bg-black/[0.02] dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.05]"
                      }`}
                    >
                      <input
                        type="radio"
                        name="push-mode"
                        value={option.value}
                        checked={pushMode === option.value}
                        onChange={() => setPushMode(option.value)}
                        className="mt-1 h-4 w-4 shrink-0 border-slate-300 text-signal-500 focus:ring-signal-500/30"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-bold">{option.label}</div>
                        <div className="mt-0.5 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                          {option.description}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>

                {pushMode !== "commit_only" && (
                  <label className="mt-4 flex flex-col gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Branch name
                    </span>
                    <input
                      type="text"
                      value={pushBranchName}
                      onInput={(event) => setPushBranchName((event.currentTarget as HTMLInputElement).value)}
                      placeholder="feature/agents-update"
                      className="rounded-xl border border-black/[0.08] bg-white/85 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-signal-500/40 focus:ring-2 focus:ring-signal-500/20 dark:border-white/[0.08] dark:bg-void-900/60 dark:text-white dark:placeholder:text-slate-500"
                    />
                  </label>
                )}

                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPushPickerOpen(false)}
                    className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:bg-black/[0.03] hover:text-slate-900 dark:border-white/[0.06] dark:text-slate-300 dark:hover:bg-white/[0.05] dark:hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitPushAgents()}
                    disabled={pushing}
                    className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white dark:text-void-900 shadow-[0_0_24px_rgba(0,224,160,0.22)] transition-all hover:bg-signal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pushing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.4} />
                    )}
                    {pushing ? "Pushing..." : "Push"}
                  </button>
                </div>
              </div>
            )}
          </div>
        }
        onPullFromFiles={() => void handlePullFromFiles()}
        onPushToFiles={() => void handlePushToFiles()}
        onCreate={() => void handleCreate()}
      />

      {/* Roster summary strip — only when project is loaded */}
      {selectedProject && presets.length > 0 && (
        <section aria-label="Roster Summary" className="grid w-full grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-4">
          <RosterStat label="Total Agents" value={rosterStats.total} accent="signal" icon={Bot} />
          <RosterStat label="Synced" value={rosterStats.synced} accent="signal" icon={ShieldCheck} />
          <RosterStat label="Drift" value={rosterStats.drift} accent={rosterStats.drift > 0 ? "amber" : "slate"} icon={AlertTriangle} />
          <RosterStat label="Database Only" value={rosterStats.local} accent="slate" icon={Database} />
        </section>
      )}

      {/* Error */}
      {(error || effectiveSettingsError) && (
        <div className="rounded-2xl border border-status-red/30 bg-status-red/[0.08] px-5 py-4 text-sm font-medium text-status-red backdrop-blur-md shadow-[0_0_20px_rgba(255,0,0,0.05)]">
          {error || effectiveSettingsError}
        </div>
      )}

      {pushFeedback && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl border border-status-green/20 bg-status-green/[0.08] px-5 py-4 text-sm font-medium text-status-green backdrop-blur-md shadow-[0_0_20px_rgba(0,171,132,0.05)]"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} />
            <div className="min-w-0">{pushFeedback}</div>
          </div>
        </div>
      )}

      {actionFeedback && (
        <div
          role={actionFeedback.tone === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`flex min-h-[3rem] items-center justify-between gap-3 rounded-2xl border px-5 py-3 text-sm font-medium backdrop-blur-md ${
            actionFeedback.tone === "error"
              ? "border-status-red/30 bg-status-red/[0.08] text-status-red"
              : actionFeedback.tone === "pending"
                ? "border-signal-500/25 bg-signal-500/[0.08] text-signal-700 dark:text-signal-300"
                : "border-status-green/20 bg-status-green/[0.08] text-status-green"
          }`}
        >
          <span>{actionFeedback.message}</span>
          {actionFeedback.retry && (
            <button
              type="button"
              onClick={actionFeedback.retry}
              className="rounded-full border border-current/25 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors hover:bg-current/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-current/30"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Info banner */}
      {selectedProject && (
        <div className="flex items-start gap-3 rounded-2xl border border-black/[0.05] bg-white/40 px-5 py-3.5 text-[13px] leading-relaxed text-slate-500 backdrop-blur-md dark:border-white/[0.05] dark:bg-white/[0.02] dark:text-slate-400">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" strokeWidth={2} />
          {projectFileSavingEnabled
            ? "Markdown mirroring enabled — saving writes a companion file under .code-ux/agents."
            : "Markdown mirroring disabled — edits stay in the database only."}
        </div>
      )}

      {/* Section divider — pure overview-style */}
      {selectedProject && presets.length > 0 && (
        <SectionDivider label="Roster" className="py-1 md:py-2" />
      )}

      {/* Content */}
      {!selectedProject ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-[1.9rem] border border-dashed border-black/[0.08] bg-white/40 px-8 py-16 text-center backdrop-blur-2xl dark:border-white/[0.08] dark:bg-void-800/40">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-signal-500/10 text-signal-600 shadow-sm ring-1 ring-slate-900/5 dark:bg-signal-500/15 dark:text-signal-400 dark:ring-white/[0.06]">
            <Bot className="h-8 w-8 text-signal-600 dark:text-signal-400" strokeWidth={1.2} />
          </div>
          <h3 className="mb-2 font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-white">Pick A Project To Begin</h3>
          <p className="max-w-sm text-sm leading-relaxed text-slate-500 dark:text-slate-400">Choose a project from the top navigation and your roster of agents will load here.</p>
        </div>
      ) : presets.length === 0 && instructionFiles.length === 0 && !loading ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-[1.9rem] border border-dashed border-black/[0.08] bg-white/40 px-8 py-16 text-center backdrop-blur-2xl dark:border-white/[0.08] dark:bg-void-800/40">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-signal-500/10 text-signal-600 shadow-sm ring-1 ring-slate-900/5 dark:bg-signal-500/15 dark:text-signal-400 dark:ring-white/[0.06]">
            <Bot className="h-8 w-8 text-signal-600 dark:text-signal-400" strokeWidth={1.2} />
          </div>
          <h3 className="mb-2 font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-white">The Workshop Is Quiet</h3>
          <p className="max-w-sm text-sm leading-relaxed text-slate-500 dark:text-slate-400">Spin up your first specialist. Give it a name, a personality, an avatar — and operator-grade system instructions.</p>
          <div className="mt-4">
            <button type="button" onClick={() => void handleCreate()} className="group inline-flex items-center gap-2 rounded-full bg-signal-500 px-6 py-3 text-sm font-bold text-white dark:text-void-900 shadow-[0_0_24px_rgba(0,224,160,0.28)] transition-all hover:scale-[1.03] hover:bg-signal-400 hover:shadow-[0_0_32px_rgba(0,224,160,0.36)] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2">
              <Plus className="h-4.5 w-4.5 transition-transform group-hover:rotate-90" strokeWidth={2.5} />
              Create First Agent
            </button>
          </div>
        </div>
      ) : presets.length > 0 || instructionFiles.length > 0 ? (
        <div className="relative flex flex-col-reverse gap-6 xl:flex-row xl:items-start">
          {/* Sidebar rail */}
          <aside className="flex w-full flex-col gap-6 xl:w-[340px] xl:shrink-0">
            {/* Agents group */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                  {presets.length} Agent{presets.length !== 1 ? "s" : ""}
                </span>
                {loading && (
                  <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-signal-500">
                    Refreshing…
                  </span>
                )}
              </div>
              {presets.length > 0 ? (
                <div className="flex flex-col gap-2.5">
                  {presets.map((preset) => (
                    <AgentPresetShowcaseCard
                      key={preset.id}
                      preset={preset}
                      routeTags={routeTagsByPresetId.get(preset.id) ?? []}
                      isSelected={selectedPresetId === preset.id && !selectedFileId}
                      onClick={() => selectAgent(preset.id)}
                    />
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  className="group flex items-center gap-3 rounded-[1.4rem] border border-dashed border-signal-500/25 bg-white/40 px-5 py-4 text-left transition-all hover:-translate-y-0.5 hover:border-signal-500/40 hover:bg-signal-500/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:border-signal-500/25 dark:bg-void-800/30"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-signal-500/10 text-signal-600 dark:bg-signal-500/15 dark:text-signal-400">
                    <Plus className="h-5 w-5 transition-transform group-hover:rotate-90" strokeWidth={2.4} />
                  </span>
                  <span className="text-[13px] font-bold text-slate-600 dark:text-slate-300">Create your first agent</span>
                </button>
              )}
            </div>

            {/* Separator + instruction files group */}
            {instructionFiles.length > 0 && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 px-1">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                    <FileText className="h-3 w-3" strokeWidth={2.4} />
                    Instruction Files
                  </span>
                  <div className="h-px flex-1 bg-gradient-to-r from-black/[0.08] to-transparent dark:from-white/[0.08]" />
                </div>
                <div className="flex flex-col gap-2.5">
                  {instructionFiles.map((file) => (
                    <InstructionFileCard
                      key={file.id}
                      file={file}
                      isSelected={selectedFileId === file.id}
                      onClick={() => selectInstructionFile(file.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </aside>

          {/* Detail / editor / file editor */}
          <div className="w-full flex-1 min-w-0">
            {selectedFile ? (
              <InstructionFileEditorPanel
                key={selectedFile.id}
                projectId={selectedProject.id}
                file={selectedFile}
                onSaved={handleInstructionFileSaved}
              />
            ) : selectedPreset ? (
              isEditing ? (
                <AgentPresetEditorPanel
                  preset={selectedPreset}
                  saving={savingId === selectedPreset.id}
                  defaultMemoryInstruction={effectiveSettings?.settings.memory.workerLearningsInstruction || ""}
                  providerOptions={providerOptions}
                  availableMcpServers={availableMcpServers}
                  availableSkillStorages={skillStorages}
                  isDashboardReplyAgent={selectedPresetIsDashboardReplyAgent}
                  onSave={handleSave}
                  onCancel={() => setIsEditing(false)}
                />
              ) : (
                <AgentPresetDetailPanel
                  preset={selectedPreset}
                  routeTags={selectedPresetRouteTags}
                  providerOptions={providerOptions}
                  availableMcpServers={availableMcpServers}
                  availableSkillStorages={skillStorages}
                  isDashboardReplyAgent={selectedPresetIsDashboardReplyAgent}
                  usageSummary={selectedAgentUsage}
                  usageLoading={selectedAgentUsageLoading}
                  onEdit={() => setIsEditing(true)}
                  onDelete={handleDelete}
                  onImport={handleImport}
                  onPushToFile={handlePushPresetToFile}
                  deleting={deletingId === selectedPreset.id}
                  importing={importingId === selectedPreset.id}
                  pushingToFile={exportingId === selectedPreset.id}
                  canPushToFile={projectFileSavingEnabled}
                />
              )
            ) : (
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-[1.9rem] border border-dashed border-black/[0.08] bg-white/40 px-8 py-16 text-center backdrop-blur-2xl dark:border-white/[0.08] dark:bg-void-800/40">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-signal-500/10 text-signal-600 dark:bg-signal-500/15 dark:text-signal-400">
                  <Bot className="h-7 w-7" strokeWidth={1.6} />
                </div>
                <p className="max-w-xs text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                  Select an agent or an instruction file from the left to view and edit it.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </PageContainer>
  );
};
