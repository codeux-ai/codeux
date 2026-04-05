import type { FunctionComponent } from "preact";
import type { ProjectSettings } from "../../../../types.js";
import { SelectInput, NumberInput } from "../SettingsFormFields.js";
import { Row } from "./SharedPanelComponents.js";
import { getProviderModelOptions } from "../../../lib/settings-view-models.js";

export const WorkerPanel: FunctionComponent<{
  settings: ProjectSettings;
  update: (patch: Partial<ProjectSettings>) => void;
  getBadge: (path: string) => string | undefined;
}> = ({ settings, update, getBadge }) => {
  const virtualWorkerModeEnabled = settings.workers.executionMode === "VIRTUAL";

  return (
        <div className="grid gap-4 lg:grid-cols-2 mb-4">
          <Row label="Worker mode" description="Connected workers stay in listen mode. Virtual workers wake only when worker work exists, run one unit of work, then shut down." badge={getBadge("workers.executionMode")}>
            <SelectInput
              value={settings.workers.executionMode}
              onChange={(value) => update({
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
          {virtualWorkerModeEnabled ? (
            <Row label="Virtual worker CLI" description="Preferred provider when worker mode is virtual. Jules is intentionally excluded from worker execution." badge={getBadge("workers.virtualWorkerProvider")}>
              <SelectInput
                value={settings.workers.virtualWorkerProvider}
                onChange={(value) => update({
                  workers: {
                    ...settings.workers,
                    virtualWorkerProvider: value as ProjectSettings["workers"]["virtualWorkerProvider"],
                    model: "default",
                  },
                })}
                options={[
                  { value: "gemini", label: "Gemini" },
                  { value: "codex", label: "Codex" },
                  { value: "claude-code", label: "Claude Code" },
                ]}
              />
            </Row>
          ) : null}
          {virtualWorkerModeEnabled ? (
            <Row label="Worker model" description="Override the global model for virtual workers. If set to 'Default', the global model for the selected CLI provider is used." badge={getBadge("workers.model")}>
              <SelectInput
                value={settings.workers.model || "default"}
                onChange={(value) => update({
                  workers: {
                    ...settings.workers,
                    model: value,
                  },
                })}
                options={[
                  { value: "default", label: `Default (${settings.aiProvider.providers[settings.workers.virtualWorkerProvider].model})` },
                  ...getProviderModelOptions(settings.workers.virtualWorkerProvider),
                ]}
              />
            </Row>
          ) : null}
          <Row label="Max concurrency" description="Maximum number of parallel tasks a worker can handle simultaneously." badge={getBadge("workers.maxConcurrency")}>
            <NumberInput
              value={settings.workers.maxConcurrency}
              min={1}
              max={20}
              onChange={(value) => update({
                workers: {
                  ...settings.workers,
                  maxConcurrency: value,
                },
              })}
            />
          </Row>
          <Row label="Dispatch timeout" description="Seconds to wait for a worker to finish a single task dispatch before timing out." badge={getBadge("workers.timeoutSeconds")}>
            <NumberInput
              value={settings.workers.timeoutSeconds}
              min={60}
              max={3600}
              onChange={(value) => update({
                workers: {
                  ...settings.workers,
                  timeoutSeconds: value,
                },
              })}
            />
          </Row>
        </div>
  );
};
