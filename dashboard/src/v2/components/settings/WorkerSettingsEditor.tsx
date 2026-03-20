import type { ComponentChildren, FunctionComponent } from "preact";
import type { ProjectSettings } from "../../../types.js";

interface LayoutCardProps {
  title: string;
  description: string;
  badge?: string;
  children: ComponentChildren;
}

interface LayoutRowProps {
  label: string;
  description: string;
  badge?: string;
  children: ComponentChildren;
}

interface SelectFieldProps {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}

interface WorkerSettingsEditorProps {
  settings: ProjectSettings;
  onChange: (next: ProjectSettings) => void;
  sectionBadge?: string;
  getBadge: (path: string) => string | undefined;
  Card: FunctionComponent<LayoutCardProps>;
  Row: FunctionComponent<LayoutRowProps>;
  SelectField: FunctionComponent<SelectFieldProps>;
}

export const WorkerSettingsEditor: FunctionComponent<WorkerSettingsEditorProps> = ({
  settings,
  onChange,
  sectionBadge,
  getBadge,
  Card,
  Row,
  SelectField,
}) => (
  <Card
    title="Workers"
    description="Control whether worker-owned execution runs on connected MCP listeners or ephemeral virtual workers."
    badge={sectionBadge}
  >
    <Row
      label="Worker mode"
      description="Connected workers stay in listen mode. Virtual workers wake for worker-owned dispatches and then shut down."
      badge={getBadge("workers.executionMode")}
    >
      <SelectField
        value={settings.workers.executionMode}
        onChange={(value) => onChange({
          ...settings,
          workers: {
            ...settings.workers,
            executionMode: value as ProjectSettings["workers"]["executionMode"],
          },
        })}
        options={[
          { value: "CONNECTED_MCP", label: "Connected MCP" },
          { value: "VIRTUAL", label: "Virtual on-demand" },
        ]}
      />
    </Row>

    <div className="rounded-[1.1rem] border border-black/[0.06] bg-black/[0.02] px-4 py-3 text-xs font-medium leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400">
      Virtual worker provider and virtual worker model have moved to the <span className="font-semibold text-slate-700 dark:text-slate-200">AI Models</span> section.
    </div>
  </Card>
);
