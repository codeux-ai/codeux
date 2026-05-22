import type { FunctionComponent, ComponentChildren } from "preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { NoticePanel } from "../SettingsSurface.js";
import { NumberInput, Row, Toggle, TextInput, TextAreaInput } from "../SettingsFormFields.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";
import { BookOpen, Brain, Gauge } from "lucide-preact";

  export const SettingsMemoryPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const {
    activeScope,
    selectedProject,
    editableSettings,
    projectSources,
    updateEditableSettings,
  } = state;

  const getBadge = (...prefixes: string[]) => getBadgeHelper(activeScope, projectSources, ...prefixes);
  const getFieldBadge = (path: string) => getFieldBadgeHelper(activeScope, projectSources, path);

    if (!editableSettings) {
      return null;
    }

    return (
      <div className="flex flex-col gap-5">
        <SectionCard title="Memory System" watermark="MEM" badge={getBadge("memory")} icon={<Brain strokeWidth={2.4} />}>
          <Row label="Enable memory" description="Turn on the memory system for automatic capture, storage, and semantic search of sprint knowledge." badge={getFieldBadge("memory.enabled")}>
            <Toggle
              value={editableSettings.memory.enabled}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, enabled: !current.memory.enabled },
              }))}
            />
          </Row>
          <Row label="Auto-capture sprint events" description="Automatically create memories when tasks complete, fail, or encounter CI issues during sprint execution." badge={getFieldBadge("memory.autoCaptureSprint")}>
            <Toggle
              value={editableSettings.memory.autoCaptureSprint}
              disabled={!editableSettings.memory.enabled}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, autoCaptureSprint: !current.memory.autoCaptureSprint },
              }))}
            />
          </Row>
          <Row label="Auto-capture agent events" description="Capture memories from notable agent interactions such as retries and clarifications." badge={getFieldBadge("memory.autoCaptureAgent")}>
            <Toggle
              value={editableSettings.memory.autoCaptureAgent}
              disabled={!editableSettings.memory.enabled}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, autoCaptureAgent: !current.memory.autoCaptureAgent },
              }))}
            />
          </Row>
          <Row label="Auto-promote to project scope" description="Automatically promote recurring or high-strength sprint memories to long-term project knowledge when a sprint completes." badge={getFieldBadge("memory.autoPromote")} last>
            <Toggle
              value={editableSettings.memory.autoPromote}
              disabled={!editableSettings.memory.enabled}
              onChange={() => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, autoPromote: !current.memory.autoPromote },
              }))}
            />
          </Row>
        </SectionCard>

        <SectionCard title="Limits" watermark="CAP" badge={getBadge("memory")} icon={<Gauge strokeWidth={2.4} />}>
          <Row label="Promotion threshold" description="Minimum score (0.0–1.0) a sprint memory needs to be auto-promoted to project scope." badge={getFieldBadge("memory.promotionThreshold")}>
            <NumberInput
              value={editableSettings.memory.promotionThreshold}
              min={0}
              max={1}
              step={0.05}
              disabled={!editableSettings.memory.enabled}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, promotionThreshold: value },
              }))}
            />
          </Row>
          <Row label="Max sprint memories" description="Maximum number of memories retained per sprint. Lowest-strength memories are evicted when exceeded." badge={getFieldBadge("memory.maxSprintMemories")}>
            <NumberInput
              value={editableSettings.memory.maxSprintMemories}
              min={10}
              max={5000}
              step={10}
              disabled={!editableSettings.memory.enabled}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, maxSprintMemories: value },
              }))}
            />
          </Row>
          <Row label="Max project memories" description="Maximum number of long-term project-scoped memories. Oldest low-strength memories are evicted when exceeded." badge={getFieldBadge("memory.maxProjectMemories")}>
            <NumberInput
              value={editableSettings.memory.maxProjectMemories}
              min={10}
              max={10000}
              step={50}
              disabled={!editableSettings.memory.enabled}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, maxProjectMemories: value },
              }))}
            />
          </Row>
          <Row label="Map edges per node" description="Maximum number of similarity connections per memory node on the neural map. Lower values produce a cleaner graph, higher values reveal more relationships." badge={getFieldBadge("memory.mapMaxEdgesPerNode")} last>
            <NumberInput
              value={editableSettings.memory.mapMaxEdgesPerNode}
              min={1}
              max={20}
              step={1}
              disabled={!editableSettings.memory.enabled}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, mapMaxEdgesPerNode: value },
              }))}
            />
          </Row>
        </SectionCard>

        <SectionCard title="Worker Learnings Instruction" watermark="LRN" badge={getBadge("memory")} icon={<BookOpen strokeWidth={2.4} />}>
          <div className="pt-2 pb-1">
            <div className="text-xs font-medium leading-relaxed text-slate-400 mb-3">
              This instruction is appended to every worker task prompt when auto-capture is enabled. It tells the AI provider what to observe and record in a temporary learnings file that gets processed into sprint memories.
            </div>
            <TextAreaInput
              value={editableSettings.memory.workerLearningsInstruction}
              rows={16}
              placeholder="Enter the instruction that tells workers what to capture..."
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                memory: { ...current.memory, workerLearningsInstruction: value },
              }))}
            />
          </div>
        </SectionCard>

        <NoticePanel title="Embedding models" tone="success">
          Download and manage embedding models from the Memory page. Once a model is active, new memories are automatically embedded for semantic search. The memory system works without a model — search falls back to text matching.
        </NoticePanel>
      </div>
    );
  };
