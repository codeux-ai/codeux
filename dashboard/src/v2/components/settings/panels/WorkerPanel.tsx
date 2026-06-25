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
  const workerProvider = settings.aiProvider.providers[settings.workers.virtualWorkerProvider];
  const workerProviderType = workerProvider?.provider || "codex";
  const workerProviderEntries = Object.entries(settings.aiProvider.providers)
    .filter(([, provider]) => provider.provider !== "jules");

  return (
        <div className="grid gap-4 lg:grid-cols-2 mb-4">
          <Row label="Worker mode" description="Worker automation is now always virtual and containerized." badge={getBadge("workers.executionMode")}>
            <SelectInput aria-label="Worker mode" aria-description="Worker automation is now always virtual and containerized."
              value="VIRTUAL"
              onChange={() => undefined}
              options={[{ value: "VIRTUAL", label: "Virtual on-demand" }]}
            />
          </Row>
          {
            <Row label="Virtual worker CLI" description="Preferred provider when worker mode is virtual. Jules is intentionally excluded from worker execution." badge={getBadge("workers.virtualWorkerProvider")}>
              <SelectInput aria-label="Virtual worker CLI" aria-description="Preferred provider when worker mode is virtual. Jules is intentionally excluded from worker execution."
                value={settings.workers.virtualWorkerProvider}
                onChange={(value) => update({
                  workers: {
                    ...settings.workers,
                    virtualWorkerProvider: value as ProjectSettings["workers"]["virtualWorkerProvider"],
                    model: "default",
                  },
                })}
                options={workerProviderEntries.map(([providerConfigId, provider]) => ({
                  value: providerConfigId,
                  label: `${provider.name} · ${provider.provider}`,
                }))}
              />
            </Row>
          }
          {
            <Row label="Worker model" description="Override the global model for virtual workers. If set to 'Default', the global model for the selected CLI provider is used." badge={getBadge("workers.model")}>
              <SelectInput aria-label="Worker model" aria-description="Override the global model for virtual workers. If set to 'Default', the global model for the selected CLI provider is used."
                value={settings.workers.model || "default"}
                onChange={(value) => update({
                  workers: {
                    ...settings.workers,
                    model: value,
                  },
                })}
                options={[
                  { value: "default", label: `Default (${workerProvider?.model || "default"})` },
                  ...getProviderModelOptions(workerProviderType),
                ]}
              />
            </Row>
          }
          <Row label="Max concurrency" description="Maximum number of parallel tasks a worker can handle simultaneously." badge={getBadge("workers.maxConcurrency")}>
            <NumberInput aria-label="Max concurrency" aria-description="Maximum number of parallel tasks a worker can handle simultaneously."
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
            <NumberInput aria-label="Dispatch timeout" aria-description="Seconds to wait for a worker to finish a single task dispatch before timing out."
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
