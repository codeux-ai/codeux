import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Bot, Plus, Info } from "lucide-preact";
import type { AgentPreset } from "./types.js";
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

/* ── Empty State ── */
const EmptyState: FunctionComponent<{ hasProject: boolean; onCreate?: () => void }> = ({ hasProject, onCreate }) => (
  <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-[2rem] border border-dashed border-signal-500/15 bg-white/60 px-8 py-20 text-center shadow-[0_2px_20px_rgba(0,0,0,0.03)] backdrop-blur-xl dark:border-signal-500/15 dark:bg-void-800/40 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
    <WaveFluid accentHex="#00E0A0" />
    <BorderTrace accentHex="#00E0A0" />

    <div className="relative z-10 flex flex-col items-center gap-5">
      <div className="agent-float flex h-20 w-20 items-center justify-center rounded-[1.5rem] bg-signal-500/8 shadow-[0_0_32px_rgba(0,224,160,0.08)] dark:bg-signal-500/10 dark:shadow-[0_0_40px_rgba(0,224,160,0.12)]">
        <Bot className="h-10 w-10 text-signal-600 dark:text-signal-500" strokeWidth={1.2} />
      </div>
      <h3 className="font-display text-2xl font-black tracking-tight text-slate-900 md:text-3xl dark:text-white">
        {hasProject ? "No Agents Yet" : "Select A Project"}
      </h3>
      <p className="max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
        {hasProject
          ? "Create your first agent with a unique personality, custom robot avatar, and system instructions."
          : "Choose a project from the top navigation to manage its agents."}
      </p>
      {hasProject && onCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="group mt-2 inline-flex items-center gap-2 rounded-full bg-signal-500 px-6 py-3 text-sm font-bold text-slate-900 shadow-lg shadow-signal-500/15 transition-all hover:scale-[1.03] hover:bg-signal-400 hover:shadow-signal-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 dark:text-void-900 dark:shadow-signal-500/20"
        >
          <Plus className="h-4.5 w-4.5 transition-transform group-hover:rotate-90" strokeWidth={2.5} />
          Create First Agent
        </button>
      )}
    </div>
  </div>
);

/* ── Main Page ── */
export const AgentsPage: FunctionComponent = () => {
  const contentRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    void refreshPresets();
  }, [selectedProject?.id]);

  useLayoutEffect(() => {
    if (!contentRef.current) return;
    gsap.fromTo(
      Array.from(contentRef.current.children),
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.65, stagger: 0.05, ease: "power4.out" }
    );
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

  const selectedPreset = presets.find((p) => p.id === selectedPresetId);

  return (
    <div ref={contentRef} className="relative z-10 mx-auto flex max-w-[1920px] flex-col gap-7 px-8 py-14 md:px-16 lg:px-20">
      <AgentsHero
        selectedProject={selectedProject}
        projectLoading={projectLoading}
        loading={loading}
        syncingAll={syncingAll}
        presets={presets}
        onSyncAll={() => void handleSyncAll()}
        onCreate={() => void handleCreate()}
      />

      {/* Error */}
      {(error || effectiveSettingsError) && (
        <div className="rounded-2xl border border-status-red/15 bg-status-red/6 px-5 py-4 text-sm font-medium text-status-red">
          {error || effectiveSettingsError}
        </div>
      )}

      {/* Info banner */}
      {selectedProject && (
        <div className="flex items-start gap-3 rounded-2xl border border-black/[0.04] bg-slate-50/60 px-5 py-3.5 text-[13px] leading-relaxed text-slate-500 dark:border-white/[0.04] dark:bg-white/[0.02] dark:text-slate-400">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" strokeWidth={2} />
          {projectFileSavingEnabled
            ? "Markdown mirroring enabled \u2014 saving writes a companion file under .code-ux/agents."
            : "Markdown mirroring disabled \u2014 edits stay in the database only."}
        </div>
      )}

      {/* Content */}
      {!selectedProject ? (
        <EmptyState hasProject={false} />
      ) : presets.length === 0 && !loading ? (
        <EmptyState hasProject onCreate={() => void handleCreate()} />
      ) : presets.length > 0 ? (
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
          {/* Sidebar */}
          <div className="flex w-full flex-col gap-2.5 xl:w-[320px] xl:shrink-0">
            <div className="mb-1 px-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                {presets.length} Agent{presets.length !== 1 ? "s" : ""}
              </span>
            </div>
            {presets.map((preset) => (
              <AgentPresetShowcaseCard
                key={preset.id}
                preset={preset}
                isSelected={selectedPresetId === preset.id}
                onClick={() => {
                  setSelectedPresetId(preset.id);
                  setIsEditing(false);
                }}
              />
            ))}
          </div>

          {/* Detail / editor */}
          <div className="w-full flex-1">
            {selectedPreset && (
              isEditing ? (
                <AgentPresetEditorPanel
                  preset={selectedPreset}
                  saving={savingId === selectedPreset.id}
                  defaultMemoryInstruction={effectiveSettings?.settings.memory.workerLearningsInstruction || ""}
                  onSave={handleSave}
                  onCancel={() => setIsEditing(false)}
                />
              ) : (
                <AgentPresetDetailPanel
                  preset={selectedPreset}
                  onEdit={() => setIsEditing(true)}
                  onDelete={handleDelete}
                  onImport={handleImport}
                  deleting={deletingId === selectedPreset.id}
                  importing={importingId === selectedPreset.id}
                />
              )
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};
