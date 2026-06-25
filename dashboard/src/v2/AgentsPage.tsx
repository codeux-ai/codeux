import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Bot, Plus, Info, ShieldCheck, AlertTriangle, Database, FileText } from "lucide-preact";
import type { AgentPreset } from "./types.js";
import type { InstructionFileSummary, InstructionFileContent } from "./lib/instruction-file-api.js";
import { fetchInstructionFiles } from "./lib/instruction-file-api.js";
import { useProjectData } from "./context/project-data.js";
import {
  createAgentPreset,
  deleteAgentPreset,
  fetchAgentPresets,
  importAgentPresetFromMarkdown,
  syncAllAgentPresetsFromMarkdown,
  updateAgentPreset,
} from "./lib/agent-preset-api.js";
import { useProjectEffectiveSettings } from "./hooks/use-project-effective-settings.js";
import { generateRandomAgentAvatar } from "./lib/agent-avatar.js";
import { WaveFluid } from "./components/ui/WaveFluid.js";
import { BorderTrace } from "./components/ui/BorderTrace.js";
import { AgentsHero } from "./components/agents/AgentsHero.js";
import { AgentPresetShowcaseCard } from "./components/agents/AgentPresetShowcaseCard.js";
import { AgentPresetDetailPanel } from "./components/agents/AgentPresetDetailPanel.js";
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
        <div className="font-display text-4xl font-black tracking-tighter text-slate-900 dark:text-white">
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


/* ── Main Page ── */
export const AgentsPage: FunctionComponent = () => {
  const contentRef = useRef<HTMLElement>(null);
  const { selectedProject, loading: projectLoading } = useProjectData();
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [projectFileSavingEnabled, setProjectFileSavingEnabled] = useState(true);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [instructionFiles, setInstructionFiles] = useState<InstructionFileSummary[]>([]);
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

  const refreshPresets = async (): Promise<void> => {
    if (!selectedProject) {
      setPresets([]);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const nextPresets = await fetchAgentPresets(selectedProject.id);
      setPresets(nextPresets);
      if (!selectedPresetId && nextPresets.length > 0) {
        setSelectedPresetId(nextPresets[0].id);
      } else if (selectedPresetId && !nextPresets.find((p) => p.id === selectedPresetId)) {
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

  useEffect(() => {
    setSelectedFileId(null);
    void refreshPresets();
    void refreshInstructionFiles();
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

  const handleCreate = async (): Promise<void> => {
    if (!selectedProject) return;
    try {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleImport = async (presetId: string): Promise<void> => {
    setImportingId(presetId);
    try {
      const updated = await importAgentPresetFromMarkdown(presetId);
      setPresets((cur) => cur.map((p) => (p.id === updated.id ? updated : p)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportingId(null);
    }
  };

  const handleSyncAll = async (): Promise<void> => {
    if (!selectedProject) return;
    setSyncingAll(true);
    try {
      setPresets(await syncAllAgentPresetsFromMarkdown(selectedProject.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncingAll(false);
    }
  };

  const handleSave = async (presetId: string, next: Parameters<typeof updateAgentPreset>[1]): Promise<void> => {
    setSavingId(presetId);
    try {
      const updated = await updateAgentPreset(presetId, next);
      setPresets((cur) => cur.map((p) => (p.id === updated.id ? updated : p)));
      setIsEditing(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (presetId: string): Promise<void> => {
    setDeletingId(presetId);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
    addManualRoute(routing?.dashboardReply.agentPresetId, "Dashboard Reply", "Worker");
    addManualRoute(routing?.clarificationReply.agentPresetId, "Clarification Reply", "Project manager");

    if (qa?.enabled) {
      if (qa.taskCompletion.enabled) {
        addManualRoute(qa.taskCompletion.agentPresetId, "QA Task", "Quality assurance agent");
      }
      if (qa.sprintCompletion.enabled) {
        addManualRoute(qa.sprintCompletion.agentPresetId, "QA Sprint", "Quality assurance agent");
      }
      if (qa.completedTaskWithoutPr.enabled) {
        addManualRoute(qa.completedTaskWithoutPr.agentPresetId, "QA No PR", "Quality assurance agent");
      }
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

  const rosterStats = useMemo(() => {
    const synced = presets.filter((p) => p.syncStatus === "synced").length;
    const drift = presets.filter((p) => p.syncStatus === "out_of_sync" || p.syncStatus === "missing_source").length;
    const local = presets.filter((p) => !p.syncStatus || p.syncStatus === "manual").length;
    return { total: presets.length, synced, drift, local };
  }, [presets]);

  return (
    <PageContainer containerRef={contentRef} padding="agents" className="gap-10 md:gap-14">
      <AgentsHero
        selectedProject={selectedProject}
        projectLoading={projectLoading}
        loading={loading}
        syncingAll={syncingAll}
        presets={presets}
        onSyncAll={() => void handleSyncAll()}
        onCreate={() => void handleCreate()}
      />

      {/* Roster summary strip — only when project is loaded */}
      {selectedProject && presets.length > 0 && (
        <section aria-label="Roster Summary" className="grid w-full grid-cols-2 gap-4 lg:grid-cols-4">
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
            <button type="button" onClick={() => void handleCreate()} className="group inline-flex items-center gap-2 rounded-full bg-signal-500 px-6 py-3 text-sm font-bold text-void-900 shadow-[0_0_24px_rgba(0,224,160,0.28)] transition-all hover:scale-[1.03] hover:bg-signal-400 hover:shadow-[0_0_32px_rgba(0,224,160,0.36)] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2">
              <Plus className="h-4.5 w-4.5 transition-transform group-hover:rotate-90" strokeWidth={2.5} />
              Create First Agent
            </button>
          </div>
        </div>
      ) : presets.length > 0 || instructionFiles.length > 0 ? (
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-start">
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
          <div className="w-full flex-1">
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
                  onSave={handleSave}
                  onCancel={() => setIsEditing(false)}
                />
              ) : (
                <AgentPresetDetailPanel
                  preset={selectedPreset}
                  routeTags={routeTagsByPresetId.get(selectedPreset.id) ?? []}
                  providerOptions={providerOptions}
                  availableMcpServers={availableMcpServers}
                  onEdit={() => setIsEditing(true)}
                  onDelete={handleDelete}
                  onImport={handleImport}
                  deleting={deletingId === selectedPreset.id}
                  importing={importingId === selectedPreset.id}
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
