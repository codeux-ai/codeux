import type { FunctionComponent } from "preact";
import type { ProjectSettings } from "../../../../types.js";
import { SelectInput, NumberInput } from "../SettingsFormFields.js";
import { Row } from "./SharedPanelComponents.js";
import { getProviderModelOptions } from "../../../lib/settings-view-models.js";
import { getSettingsOperationsNumberError, useSettingsOperationsTranslations } from "../../../i18n/messages/settings-operations.js";

export const WorkerPanel: FunctionComponent<{
  settings: ProjectSettings;
  update: (patch: Partial<ProjectSettings>) => void;
  getBadge: (path: string) => string | undefined;
}> = ({ settings, update, getBadge }) => {
  const { t } = useSettingsOperationsTranslations();
  const workerProvider = settings.aiProvider.providers[settings.workers.virtualWorkerProvider];
  const workerProviderType = workerProvider?.provider || "codex";
  const workerProviderEntries = Object.entries(settings.aiProvider.providers)
    .filter(([, provider]) => provider.provider !== "jules");

  return (
        <div className="grid gap-4 lg:grid-cols-2 mb-4">
          <Row label={t("Worker mode")} description={t("Worker automation is now always virtual and containerized.")} badge={getBadge("workers.executionMode")}>
            <SelectInput aria-label={t("Worker mode")} aria-description={t("Worker automation is now always virtual and containerized.")}
              value="VIRTUAL"
              onChange={() => undefined}
              options={[{ value: "VIRTUAL", label: t("Virtual on-demand") }]}
            />
          </Row>
          {
            <Row label={t("Virtual worker CLI")} description={t("Preferred provider when worker mode is virtual. Jules is intentionally excluded from worker execution.")} badge={getBadge("workers.virtualWorkerProvider")}>
              <SelectInput aria-label={t("Virtual worker CLI")} aria-description={t("Preferred provider when worker mode is virtual. Jules is intentionally excluded from worker execution.")}
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
            <Row label={t("Worker model")} description={t("Override the global model for virtual workers. If set to 'Default', the global model for the selected CLI provider is used.")} badge={getBadge("workers.model")}>
              <SelectInput aria-label={t("Worker model")} aria-description={t("Override the global model for virtual workers. If set to 'Default', the global model for the selected CLI provider is used.")}
                value={settings.workers.model || "default"}
                onChange={(value) => update({
                  workers: {
                    ...settings.workers,
                    model: value,
                  },
                })}
                options={[
                  { value: "default", label: t("Default ({model})", { model: workerProvider?.model || "default" }) },
                  ...getProviderModelOptions(workerProviderType),
                ]}
              />
            </Row>
          }
          <Row label={t("Max concurrency")} description={t("Maximum number of parallel tasks a worker can handle simultaneously.")} badge={getBadge("workers.maxConcurrency")}>
            <NumberInput aria-label={t("Max concurrency")} aria-description={t("Maximum number of parallel tasks a worker can handle simultaneously.")}
              value={settings.workers.maxConcurrency}
              min={1}
              max={100}
              errorText={getSettingsOperationsNumberError(settings.workers.maxConcurrency, 1, 100, t)}
              onChange={(value) => update({
                workers: {
                  ...settings.workers,
                  maxConcurrency: value,
                },
              })}
            />
          </Row>
          <Row label={t("Dispatch timeout")} description={t("Seconds to wait for a worker to finish a single task dispatch before timing out.")} badge={getBadge("workers.timeoutSeconds")}>
            <NumberInput aria-label={t("Dispatch timeout")} aria-description={t("Seconds to wait for a worker to finish a single task dispatch before timing out.")}
              value={settings.workers.timeoutSeconds}
              min={60}
              max={3600}
              errorText={getSettingsOperationsNumberError(settings.workers.timeoutSeconds, 60, 3600, t)}
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
