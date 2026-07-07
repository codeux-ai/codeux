import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { Row, Toggle, SelectInput, PillChoiceGroup } from "../SettingsFormFields.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";
import { Database, FileText, Plus, Route, Sparkles, Trash2 } from "lucide-preact";
import type { ProjectSettings, SkillStorageRecord } from "../../../../types.js";
import { AgentSelectAvatarIcon } from "../../agents/AgentSelectAvatarIcon.js";
import { createSkillStorage, deleteSkillStorage, fetchSkillStorages, updateAgentPreset } from "../../../lib/agent-preset-api.js";
import { ConfirmDialog } from "../../ui/ConfirmDialog.js";
import { SelfReflectionControls } from "./QAPanel.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../../lib/settings.js";

const DEFAULT_AGENT_ROUTING: ProjectSettings["agents"]["routing"] = {
  planning: { agentPresetId: null },
  taskCoding: { mode: "MANUAL", agentPresetId: null, orchestratorAgentPresetIds: [] },
  ciFix: { agentPresetId: null },
  mergeConflict: { agentPresetId: null },
  dashboardReply: { agentPresetId: null },
  clarificationReply: { agentPresetId: null },
};

const normalizeAgentRoutingSettings = (
  routing: Partial<ProjectSettings["agents"]["routing"]> | undefined,
): ProjectSettings["agents"]["routing"] => ({
  planning: { ...DEFAULT_AGENT_ROUTING.planning, ...routing?.planning },
  taskCoding: {
    ...DEFAULT_AGENT_ROUTING.taskCoding,
    ...routing?.taskCoding,
    orchestratorAgentPresetIds: routing?.taskCoding?.orchestratorAgentPresetIds
      ? [...routing.taskCoding.orchestratorAgentPresetIds]
      : [],
  },
  ciFix: { ...DEFAULT_AGENT_ROUTING.ciFix, ...routing?.ciFix },
  mergeConflict: { ...DEFAULT_AGENT_ROUTING.mergeConflict, ...routing?.mergeConflict },
  dashboardReply: { ...DEFAULT_AGENT_ROUTING.dashboardReply, ...routing?.dashboardReply },
  clarificationReply: { ...DEFAULT_AGENT_ROUTING.clarificationReply, ...routing?.clarificationReply },
});

export const SettingsAgentsPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const {
    activeScope,
    setActiveScope,
    selectedProject,
    editableSettings,
    projectSettings,
    projectSources,
    projectAgentPresets = [],
    projectAgentPresetOptions,
    updateProject,
    updateEditableSettings,
  } = state;
  const [skillStorages, setSkillStorages] = useState<SkillStorageRecord[]>([]);
  const [storageName, setStorageName] = useState("");
  const [storageDescription, setStorageDescription] = useState("");
  const [storageBusy, setStorageBusy] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SkillStorageRecord | null>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  const getBadge = (...prefixes: string[]) => getBadgeHelper(activeScope, projectSources, ...prefixes);
  const getFieldBadge = (path: string) => getFieldBadgeHelper(activeScope, projectSources, path);

  if (!editableSettings) {
    return null;
  }

  const agentRoutingSettings = normalizeAgentRoutingSettings(projectSettings?.agents.routing ?? editableSettings.agents.routing);
  const projectAgentSelectOptions = projectAgentPresetOptions.map((option) => ({
    ...option,
    icon: () => <AgentSelectAvatarIcon avatarConfig={option.avatarConfig} seed={`${option.value}:${option.label}`} />,
  }));
  const agentPresetSelectorsDisabled = !selectedProject || !projectSettings;
  const skillStoragesById = useMemo(
    () => new Map(skillStorages.map((storage) => [storage.id, storage])),
    [skillStorages],
  );
  const agentSectionBadge = selectedProject
    ? getBadgeHelper("project", projectSources, "agents.routing")
    : getBadge("agents.routing");
  const updateAgentRoutingSettings = (recipe: (current: typeof agentRoutingSettings) => typeof agentRoutingSettings) => {
    if (selectedProject && projectSettings) {
      if (activeScope !== "project") {
        setActiveScope("project");
      }
      updateProject((current) => ({
        ...current,
        agents: {
          ...current.agents,
          routing: recipe(normalizeAgentRoutingSettings(current.agents.routing)),
        },
      }));
      return;
    }

    updateEditableSettings((current) => ({
      ...current,
      agents: {
        ...current.agents,
        routing: recipe(normalizeAgentRoutingSettings(current.agents.routing)),
      },
    }));
  };

  const toggleOrchestratorAgent = (agentPresetId: string): void => {
    updateAgentRoutingSettings((current) => {
      const selected = current.taskCoding.orchestratorAgentPresetIds;
      return {
        ...current,
        taskCoding: {
          ...current.taskCoding,
          orchestratorAgentPresetIds: selected.includes(agentPresetId)
            ? selected.filter((id) => id !== agentPresetId)
            : [...selected, agentPresetId],
        },
      };
    });
  };

  useEffect(() => {
    let cancelled = false;
    setSkillStorages([]);
    setStorageError(null);
    if (!selectedProject) {
      return undefined;
    }

    fetchSkillStorages(selectedProject.id)
      .then((storages) => {
        if (!cancelled) {
          setSkillStorages(storages);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStorageError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => { cancelled = true; };
  }, [selectedProject?.id]);

  const createStorage = async (): Promise<void> => {
    if (!selectedProject || storageBusy) {
      return;
    }
    const trimmedName = storageName.trim();
    if (!trimmedName) {
      setStorageError("Storage name is required.");
      return;
    }
    setStorageBusy("create");
    try {
      const created = await createSkillStorage(selectedProject.id, {
        name: trimmedName,
        description: storageDescription.trim(),
        storageKind: "project",
      });
      setSkillStorages((current) => [...current, created]);
      setStorageName("");
      setStorageDescription("");
      setStorageError(null);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    } finally {
      setStorageBusy(null);
    }
  };

  const confirmDeleteStorage = async (): Promise<void> => {
    if (!selectedProject || !deleteTarget || storageBusy) {
      return;
    }
    setStorageBusy(`delete:${deleteTarget.id}`);
    try {
      await deleteSkillStorage(selectedProject.id, deleteTarget.id);
      setSkillStorages((current) => current.filter((storage) => storage.id !== deleteTarget.id));
      setDeleteTarget(null);
      setStorageError(null);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    } finally {
      setStorageBusy(null);
    }
  };

  const toggleAgentStorage = async (agentPresetId: string, storageId: string): Promise<void> => {
    const preset = projectAgentPresets.find((candidate) => candidate.id === agentPresetId);
    if (!preset || storageBusy) {
      return;
    }
    const currentIds: string[] = preset.persistentSkillStorageIds ?? [];
    const nextIds = currentIds.includes(storageId)
      ? currentIds.filter((id) => id !== storageId)
      : [...currentIds, storageId];
    setStorageBusy(`attach:${agentPresetId}:${storageId}`);
    try {
      await updateAgentPreset(agentPresetId, {
        persistentSkillStorageIds: nextIds,
        persistentSkillStorage: {
          enabled: nextIds.length > 0 ? (preset.persistentSkillStorage?.enabled ?? false) : false,
        },
      });
      preset.persistentSkillStorageIds = nextIds;
      preset.persistentSkillStorage = {
        enabled: nextIds.length > 0 ? (preset.persistentSkillStorage?.enabled ?? false) : false,
      };
      setStorageError(null);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    } finally {
      setStorageBusy(null);
    }
  };

  const toggleAgentSkillEnabled = async (agentPresetId: string, enabled: boolean): Promise<void> => {
    const preset = projectAgentPresets.find((candidate) => candidate.id === agentPresetId);
    if (!preset || storageBusy) {
      return;
    }
    const storageIds = preset.persistentSkillStorageIds ?? [];
    setStorageBusy(`enable:${agentPresetId}`);
    try {
      await updateAgentPreset(agentPresetId, {
        persistentSkillStorageIds: storageIds,
        persistentSkillStorage: { enabled: enabled && storageIds.length > 0 },
      });
      preset.persistentSkillStorage = { enabled: enabled && storageIds.length > 0 };
      setStorageError(null);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    } finally {
      setStorageBusy(null);
    }
  };

  const planningSelfReflectionSettings = projectSettings?.agents.selfReflection?.planning
    ?? editableSettings.agents.selfReflection?.planning
    ?? DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection.planning;
  const qaSelfReflectionSettings = projectSettings?.agents.selfReflection?.qualityAssurance
    ?? editableSettings.agents.selfReflection?.qualityAssurance
    ?? DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection.qualityAssurance;
  const updateSelfReflection = (
    key: keyof ProjectSettings["agents"]["selfReflection"],
    next: ProjectSettings["agents"]["selfReflection"]["planning"],
  ): void => {
    if (selectedProject && projectSettings) {
      if (activeScope !== "project") {
        setActiveScope("project");
      }
      updateProject((current) => ({
        ...current,
        agents: {
          ...current.agents,
          selfReflection: {
            ...(current.agents.selfReflection ?? DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection),
            [key]: next,
          },
        },
      }));
      return;
    }

    updateEditableSettings((current) => ({
      ...current,
      agents: {
        ...current.agents,
        selfReflection: {
          ...(current.agents.selfReflection ?? DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection),
          [key]: next,
        },
      },
    }));
  };

  return (
    <div className="flex flex-col gap-5">
      <SectionCard title="Project Markdown Mirror" watermark="AGT" badge={getBadge("agents")} icon={<FileText strokeWidth={2.4} />}>
        <Row
          label="Save agent markdown to project directory"
          description="When enabled, dashboard edits write a companion markdown file under `.code-ux/agents` for the selected project. Default and home agent files are never modified."
          badge={getFieldBadge("agents.saveToProjectDirectory")}
        >
          <Toggle aria-label="Toggle setting"             value={editableSettings.agents.saveToProjectDirectory}
            onChange={() => updateEditableSettings((current) => ({
              ...current,
              agents: {
                ...current.agents,
                saveToProjectDirectory: !current.agents.saveToProjectDirectory,
              },
            }))}
          />
        </Row>
        <Row label="Mirror directory" description="Dashboard-authored markdown companions live alongside other project-local Code UX files." last>
          <div className="rounded-xl bg-black/[0.04] px-3 py-2 font-mono text-sm text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
            .code-ux/agents
          </div>
        </Row>
      </SectionCard>

      <SectionCard title="Agent Routing" watermark="RTE" badge={agentSectionBadge} icon={<Route strokeWidth={2.4} />}>
        <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
          <div className="rounded-[1.35rem] border border-black/[0.06] bg-black/[0.02] p-4 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Coding tasks</div>
            <div className="mt-2">
              Manual pins all coding work to one preset. Orchestrator gives the Planning agent a roster and lets it assign the best specialist per task.
            </div>
            {selectedProject && activeScope !== "project" ? (
              <div className="mt-3 rounded-xl border border-signal-500/18 bg-signal-500/[0.08] px-3 py-2 text-signal-700 dark:border-signal-400/18 dark:bg-signal-400/[0.08] dark:text-signal-200">
                Routing edits switch to Project scope for {selectedProject.name}.
              </div>
            ) : null}
          </div>

          <div className="rounded-[1.35rem] border border-black/[0.06] bg-white/78 p-5 dark:border-white/[0.06] dark:bg-void-900/52 md:p-6">
            <Row label="Coding task routing" description="Choose whether coding tasks use one fixed agent or a Planning-agent-selected specialist.">
              <PillChoiceGroup
                value={agentRoutingSettings.taskCoding.mode}
                onChange={(value) => updateAgentRoutingSettings((current) => ({
                  ...current,
                  taskCoding: {
                    ...current.taskCoding,
                    mode: value === "ORCHESTRATOR" ? "ORCHESTRATOR" : "MANUAL",
                  },
                }))}
                options={[
                  { value: "MANUAL", label: "Manual", hint: "Pin one coding agent." },
                  { value: "ORCHESTRATOR", label: "Orchestrator", hint: "Planner selects per task." },
                ]}
              />
            </Row>

            {agentRoutingSettings.taskCoding.mode === "ORCHESTRATOR" ? (
              <div className="py-5">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Available to orchestrator</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {agentRoutingSettings.taskCoding.orchestratorAgentPresetIds.length} selected
                  </div>
                </div>
                <div className="rounded-2xl border border-black/[0.05] bg-black/[0.015] p-3 dark:border-white/[0.06] dark:bg-white/[0.025]">
                  <div className="flex flex-wrap gap-2">
                    {projectAgentPresetOptions.map((option) => {
                      const active = agentRoutingSettings.taskCoding.orchestratorAgentPresetIds.includes(option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          disabled={agentPresetSelectorsDisabled}
                          onClick={() => toggleOrchestratorAgent(option.value)}
                          className={`rounded-full border px-3 py-2 text-[11px] font-semibold tracking-wide transition-colors disabled:opacity-50 ${
                            active
                              ? "border-signal-500/35 bg-signal-500/12 text-signal-700 dark:border-signal-400/35 dark:bg-signal-400/12 dark:text-signal-200"
                              : "border-black/[0.08] bg-white/78 text-slate-500 dark:border-white/[0.08] dark:bg-void-900/60 dark:text-slate-400"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {projectAgentPresetOptions.length === 0 ? (
                  <div className="mt-3 rounded-[1.15rem] border border-dashed border-black/[0.06] bg-black/[0.02] px-4 py-3 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400">
                    Create project agents first, then return here to expose coding specialists to the orchestrator.
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {([
                ["planning", "Planning agent", "Used for sprint planning and prompt improvement.", "Built-in Planning agent"],
                ...(agentRoutingSettings.taskCoding.mode === "MANUAL"
                  ? [["taskCoding", "Coding agent", "Used for task coding when no task-level orchestrator assignment exists.", "Built-in Worker agent"] as const]
                  : []),
                ["ciFix", "CI fix", "Used for automated CI repair loops.", "Built-in Worker agent"],
                ["mergeConflict", "Merge conflict", "Used for automated conflict resolution.", "Built-in Worker agent"],
                ["dashboardReply", "Dashboard reply", "Used for generated dashboard chat replies.", "Built-in Worker agent"],
                ["clarificationReply", "Clarification reply", "Used for automatic worker clarification replies.", "Built-in Project manager agent"],
              ] as const).map(([key, label, description, builtInLabel]) => (
                <div
                  key={key}
                  className="flex min-w-0 flex-col gap-3 rounded-2xl border border-black/[0.05] bg-white/55 p-4 dark:border-white/[0.06] dark:bg-white/[0.025]"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</div>
                    <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{description}</div>
                  </div>
                  <SelectInput
                    value={agentRoutingSettings[key].agentPresetId || ""}
                    onChange={(value) => updateAgentRoutingSettings((current) => ({
                      ...current,
                      [key]: key === "taskCoding"
                        ? { ...current.taskCoding, agentPresetId: value || null }
                        : { agentPresetId: value || null },
                    }))}
                    options={[{ value: "", label: builtInLabel, icon: () => <AgentSelectAvatarIcon seed={`built-in:${key}:${builtInLabel}`} /> }, ...projectAgentSelectOptions]}
                    disabled={agentPresetSelectorsDisabled}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Persistent Skill Storage" watermark="SKL" icon={<Database strokeWidth={2.4} />}>
        <Row
          label="Skill storage is separate from memory"
          description="Persistent skills are explicit project-owned stores that agents can search only after a storage is attached and retrieval is enabled for that agent."
          badge={selectedProject ? undefined : "Project only"}
        >
          <div className="rounded-[1rem] border border-black/[0.06] bg-black/[0.02] px-4 py-3 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400">
            {selectedProject
              ? "Default off: creating storage does not change runtime behavior. Attach storage to an agent, then enable persistent skills for that agent."
              : "Select a project to create storage and attach it to project agent presets."}
          </div>
        </Row>

        <Row label="Create storage" description="Create a named container for durable skill markdown. Storage deletion is destructive and requires confirmation.">
          <div className="grid w-full min-w-0 gap-3 lg:grid-cols-[minmax(160px,0.8fr)_minmax(220px,1.2fr)_auto]">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Storage name</span>
              <input
                type="text"
                value={storageName}
                disabled={!selectedProject || Boolean(storageBusy)}
                onInput={(event) => setStorageName(event.currentTarget.value)}
                className="rounded-xl border border-black/[0.08] bg-white/80 px-3 py-2 text-sm text-slate-800 outline-none focus:border-signal-500/40 focus:ring-2 focus:ring-signal-500/20 disabled:opacity-50 dark:border-white/[0.08] dark:bg-void-900/60 dark:text-slate-100"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Description</span>
              <input
                type="text"
                value={storageDescription}
                disabled={!selectedProject || Boolean(storageBusy)}
                onInput={(event) => setStorageDescription(event.currentTarget.value)}
                className="rounded-xl border border-black/[0.08] bg-white/80 px-3 py-2 text-sm text-slate-800 outline-none focus:border-signal-500/40 focus:ring-2 focus:ring-signal-500/20 disabled:opacity-50 dark:border-white/[0.08] dark:bg-void-900/60 dark:text-slate-100"
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void createStorage()}
                disabled={!selectedProject || Boolean(storageBusy)}
                className="inline-flex min-h-10 items-center gap-2 rounded-full border border-signal-500/25 bg-signal-500/[0.08] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-700 transition-colors hover:bg-signal-500/[0.14] disabled:cursor-not-allowed disabled:opacity-50 dark:text-signal-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
                Add storage
              </button>
            </div>
          </div>
        </Row>

        {storageError ? (
          <div role="alert" className="rounded-[1rem] border border-status-red/25 bg-status-red/[0.08] px-4 py-3 text-xs font-semibold text-status-red">
            {storageError}
          </div>
        ) : null}

        <Row label="Project storages" description="List and remove project-owned skill stores. Deleting a store removes its skills, embeddings, and attachments.">
          <div className="grid w-full gap-2">
            {skillStorages.length === 0 ? (
              <div className="rounded-[1rem] border border-dashed border-black/[0.06] bg-black/[0.02] px-4 py-3 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400">
                No persistent skill storages are configured for this project.
              </div>
            ) : skillStorages.map((storage) => (
              <div key={storage.id} className="flex flex-col gap-3 rounded-[1rem] border border-black/[0.06] bg-white/65 p-3 dark:border-white/[0.06] dark:bg-white/[0.04] sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{storage.name}</div>
                  <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {storage.description || "No description"} · {storage.storageKind}
                  </div>
                </div>
                <button
                  ref={deleteButtonRef}
                  type="button"
                  onClick={() => setDeleteTarget(storage)}
                  disabled={Boolean(storageBusy)}
                  aria-label={`Delete ${storage.name}`}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-status-red/20 bg-status-red/[0.06] text-status-red transition-colors hover:bg-status-red/[0.12] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-status-red/30"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2.4} />
                </button>
              </div>
            ))}
          </div>
        </Row>

        <Row label="Attach storage to agents" description="Attach one or more storages to each project agent. Runtime retrieval stays off until the agent opt-in is enabled." last>
          <div className="grid w-full gap-3">
            {projectAgentPresets.length === 0 ? (
              <div className="rounded-[1rem] border border-dashed border-black/[0.06] bg-black/[0.02] px-4 py-3 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400">
                Create project agents before attaching persistent skill storage.
              </div>
            ) : projectAgentPresets.map((preset) => {
              const attachedIds = preset.persistentSkillStorageIds ?? [];
              const active = Boolean(preset.persistentSkillStorage?.enabled && attachedIds.length > 0);
              return (
                <div key={preset.id} className="rounded-[1rem] border border-black/[0.06] bg-white/65 p-3 dark:border-white/[0.06] dark:bg-white/[0.04]">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{preset.name}</div>
                      <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                        {active ? "Persistent skills enabled for attached storages." : "Persistent skills off until storage is attached and enabled."}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${active ? "border-signal-500/25 bg-signal-500/[0.08] text-signal-700 dark:text-signal-200" : "border-black/[0.06] bg-black/[0.03] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400"}`}>
                        {active ? "Enabled" : "Default off"}
                      </span>
                      <Toggle
                        aria-label={`Enable persistent skills for ${preset.name}`}
                        value={active}
                        onChange={(value) => void toggleAgentSkillEnabled(preset.id, value)}
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {skillStorages.length === 0 ? (
                      <span className="text-xs text-slate-500 dark:text-slate-400">No storages available.</span>
                    ) : skillStorages.map((storage) => {
                      const checked = attachedIds.includes(storage.id);
                      return (
                        <label
                          key={`${preset.id}:${storage.id}`}
                          className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-semibold transition-colors ${checked ? "border-signal-500/30 bg-signal-500/[0.1] text-signal-800 dark:text-signal-100" : "border-black/[0.06] bg-black/[0.02] text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300"}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={Boolean(storageBusy)}
                            onChange={() => void toggleAgentStorage(preset.id, storage.id)}
                            className="h-4 w-4 rounded border-black/20 text-signal-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-focus-ring)]"
                          />
                          {skillStoragesById.get(storage.id)?.name ?? storage.name}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Row>
      </SectionCard>

      <SectionCard title="Self-Reflection" watermark="REF" icon={<Sparkles strokeWidth={2.4} />}>
        <SelfReflectionControls
          title="Planning self-reflection"
          description="Optionally rates sprint planning output against editable criteria and can request improved planning before accepting it."
          settings={planningSelfReflectionSettings}
          update={(next) => updateSelfReflection("planning", next)}
          getBadge={getFieldBadge}
          basePath="agents.selfReflection.planning"
        />
        <SelfReflectionControls
          title="QA self-reflection"
          description="Optionally rates QA review output against editable criteria and can request improved QA output before accepting it."
          settings={qaSelfReflectionSettings}
          update={(next) => updateSelfReflection("qualityAssurance", next)}
          getBadge={getFieldBadge}
          basePath="agents.selfReflection.qualityAssurance"
          last
        />
      </SectionCard>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        options={{
          title: "Delete persistent skill storage?",
          body: deleteTarget
            ? `Deleting ${deleteTarget.name} removes its skills, embeddings, and agent attachments. This cannot be undone from the dashboard.`
            : "Deleting this storage removes its skills, embeddings, and agent attachments.",
          confirmLabel: "Delete storage",
          cancelLabel: "Keep storage",
          destructive: true,
        }}
        onConfirm={() => void confirmDeleteStorage()}
        onCancel={() => {
          setDeleteTarget(null);
          window.setTimeout(() => deleteButtonRef.current?.focus(), 0);
        }}
      />
    </div>
  );
};
