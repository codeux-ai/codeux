import type { FunctionComponent } from "preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { NumberInput, Row, TextInput, Toggle } from "../SettingsFormFields.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";
import { AlertTriangle, Eye, Gauge, SlidersHorizontal, SquareTerminal } from "lucide-preact";
import { PreviewEnvironmentEditor } from "../../browser/PreviewEnvironmentEditor.js";
import { getSettingsOperationsNumberError, useSettingsOperationsTranslations } from "../../../i18n/messages/settings-operations.js";

export const SettingsBrowserPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const { t } = useSettingsOperationsTranslations();
  const {
    activeScope,
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
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <SectionCard
        title={t("Workspace Visibility")}
        watermark="WEB"
        badge={getBadge("sprintPreview")}
        icon={<Eye strokeWidth={2.4} />}
        highlights={[
          { label: t("Preview runtime"), value: editableSettings.sprintPreview.enabled ? t("Enabled") : t("Off"), tone: editableSettings.sprintPreview.enabled ? "active" : "warning" },
          { label: t("Browser workspace"), value: editableSettings.sprintPreview.showInAppBrowser ? t("Visible") : t("Hidden") },
          { label: t("Sprint start"), value: editableSettings.sprintPreview.autoStartOnRunningSprint ? t("Auto-launch") : t("Manual") },
        ]}
      >
        <Row label={t("Preview runtime enabled")} description={t("Allow Code UX to launch, rebuild, and reconcile preview containers for this scope.")} badge={getFieldBadge("sprintPreview.enabled")}>
          <Toggle aria-label={t("Toggle setting")} value={editableSettings.sprintPreview.enabled} onChange={() => updateEditableSettings((current) => ({
            ...current,
            sprintPreview: {
              ...current.sprintPreview,
              enabled: !current.sprintPreview.enabled,
            },
          }))} />
        </Row>
        <Row label={t("Show in-app browser workspace")} description={t("Expose Browser entry points in the dashboard and allow the embedded preview workspace to render.")} badge={getFieldBadge("sprintPreview.showInAppBrowser")}>
          <Toggle aria-label={t("Toggle setting")} value={editableSettings.sprintPreview.showInAppBrowser} onChange={() => updateEditableSettings((current) => ({
            ...current,
            sprintPreview: {
              ...current.sprintPreview,
              showInAppBrowser: !current.sprintPreview.showInAppBrowser,
            },
          }))} />
        </Row>
        <Row label={t("Launch preview when sprint starts")} description={t("Start a preview container automatically when Code UX detects the sprint is actively running.")} badge={getFieldBadge("sprintPreview.autoStartOnRunningSprint")}>
          <Toggle aria-label={t("Toggle setting")} value={editableSettings.sprintPreview.autoStartOnRunningSprint} onChange={() => updateEditableSettings((current) => ({
            ...current,
            sprintPreview: {
              ...current.sprintPreview,
              autoStartOnRunningSprint: !current.sprintPreview.autoStartOnRunningSprint,
            },
          }))} />
        </Row>
        <Row label={t("Rebuild preview on task completion")} description={t("Refresh the active preview after a task finishes so the container reflects the latest sprint output.")} badge={getFieldBadge("sprintPreview.rebuildOnTaskCompletion")}>
          <Toggle aria-label={t("Toggle setting")} value={editableSettings.sprintPreview.rebuildOnTaskCompletion} onChange={() => updateEditableSettings((current) => ({
            ...current,
            sprintPreview: {
              ...current.sprintPreview,
              rebuildOnTaskCompletion: !current.sprintPreview.rebuildOnTaskCompletion,
            },
          }))} />
        </Row>
        <Row label={t("Rebuild preview on sprint completion")} description={t("Run one final rebuild when the sprint reaches its completed terminal state.")} badge={getFieldBadge("sprintPreview.rebuildOnSprintCompletion")}>
          <Toggle aria-label={t("Toggle setting")} value={editableSettings.sprintPreview.rebuildOnSprintCompletion} onChange={() => updateEditableSettings((current) => ({
            ...current,
            sprintPreview: {
              ...current.sprintPreview,
              rebuildOnSprintCompletion: !current.sprintPreview.rebuildOnSprintCompletion,
            },
          }))} />
        </Row>
        <Row label={t("Stop preview when sprint ends")} description={t("Shut down the preview container automatically when the sprint finishes, fails, or is cancelled.")} badge={getFieldBadge("sprintPreview.autoStopOnTerminalSprint")} last>
          <Toggle aria-label={t("Toggle setting")} value={editableSettings.sprintPreview.autoStopOnTerminalSprint} onChange={() => updateEditableSettings((current) => ({
            ...current,
            sprintPreview: {
              ...current.sprintPreview,
              autoStopOnTerminalSprint: !current.sprintPreview.autoStopOnTerminalSprint,
            },
          }))} />
        </Row>
      </SectionCard>

      <SectionCard
        title={t("Runtime Limits")}
        watermark="PORT"
        badge={getBadge("sprintPreview")}
        icon={<Gauge strokeWidth={2.4} />}
        highlights={[
          { label: t("Active previews"), value: t("{count} max", { count: editableSettings.sprintPreview.maxConcurrentContainers }), tone: "active" },
          { label: t("Host ports"), value: `${editableSettings.sprintPreview.hostPortRangeStart}–${editableSettings.sprintPreview.hostPortRangeEnd}` },
          { label: t("App port"), value: editableSettings.sprintPreview.containerAppPort },
        ]}
      >
        <Row label={t("Maximum active preview containers")} description={t("When this cap is exceeded, Code UX stops the oldest active previews before launching the next one.")} badge={getFieldBadge("sprintPreview.maxConcurrentContainers")}>
          <NumberInput
            value={editableSettings.sprintPreview.maxConcurrentContainers}
            aria-label={t("Maximum active preview containers")}
            aria-description={t("When this cap is exceeded, Code UX stops the oldest active previews before launching the next one.")}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              sprintPreview: {
                ...current.sprintPreview,
                maxConcurrentContainers: value,
              },
            }))}
            min={1}
            max={100}
            errorText={getSettingsOperationsNumberError(editableSettings.sprintPreview.maxConcurrentContainers, 1, 100, t)}
          />
        </Row>
        <Row label={t("Host port range start")} description={t("Lower bound for preview host-port allocation. Preview ports bind to localhost only.")} badge={getFieldBadge("sprintPreview.hostPortRangeStart")}>
          <NumberInput
            value={editableSettings.sprintPreview.hostPortRangeStart}
            aria-label={t("Host port range start")}
            aria-description={t("Lower bound for preview host-port allocation. Preview ports bind to localhost only.")}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              sprintPreview: {
                ...current.sprintPreview,
                hostPortRangeStart: value,
              },
            }))}
            min={1}
            max={65535}
            errorText={getSettingsOperationsNumberError(editableSettings.sprintPreview.hostPortRangeStart, 1, 65535, t)}
          />
        </Row>
        <Row label={t("Host port range end")} description={t("Upper bound for preview host-port allocation.")} badge={getFieldBadge("sprintPreview.hostPortRangeEnd")}>
          <NumberInput
            value={editableSettings.sprintPreview.hostPortRangeEnd}
            aria-label={t("Host port range end")}
            aria-description={t("Upper bound for preview host-port allocation.")}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              sprintPreview: {
                ...current.sprintPreview,
                hostPortRangeEnd: value,
              },
            }))}
            min={1}
            max={65535}
            errorText={getSettingsOperationsNumberError(editableSettings.sprintPreview.hostPortRangeEnd, 1, 65535, t)}
          />
        </Row>
        <Row label={t("Container app port")} description={t("Internal port the preview app listens on inside the container before Code UX maps it to a host port.")} badge={getFieldBadge("sprintPreview.containerAppPort")}>
          <NumberInput
            value={editableSettings.sprintPreview.containerAppPort}
            aria-label={t("Container app port")}
            aria-description={t("Internal port the preview app listens on inside the container before Code UX maps it to a host port.")}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              sprintPreview: {
                ...current.sprintPreview,
                containerAppPort: value,
              },
            }))}
            min={1}
            max={65535}
            errorText={getSettingsOperationsNumberError(editableSettings.sprintPreview.containerAppPort, 1, 65535, t)}
          />
        </Row>
        <Row label={t("Startup script path")} description={t("Project-relative path used for the editable preview startup override script.")} badge={getFieldBadge("sprintPreview.startupScriptPath")}>
          <TextInput
            value={editableSettings.sprintPreview.startupScriptPath}
            aria-label={t("Startup script path")}
            aria-description={t("Project-relative path used for the editable preview startup override script.")}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              sprintPreview: {
                ...current.sprintPreview,
                startupScriptPath: value,
              },
            }))}
            mono
          />
        </Row>
        <Row label={t("Default startup command")} description={t("Optional command that replaces auto-detected preview startup. Per-container overrides can be set from Browser.")} badge={getFieldBadge("sprintPreview.startupCommand")} last>
          <TextInput
            value={editableSettings.sprintPreview.startupCommand ?? ""}
            aria-label={t("Default startup command")}
            aria-description={t("Optional command that replaces auto-detected preview startup. Per-container overrides can be set from Browser.")}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              sprintPreview: {
                ...current.sprintPreview,
                startupCommand: value,
              },
            }))}
            placeholder="pnpm dev --host 0.0.0.0"
            mono
          />
        </Row>
      </SectionCard>

      <SectionCard
        title={t("Docker Access")}
        watermark="ROOT"
        badge={getBadge("sprintPreview.allowDockerAccess")}
        icon={<SquareTerminal strokeWidth={2.4} />}
        highlights={[
          { label: t("Host daemon"), value: editableSettings.sprintPreview.allowDockerAccess ? t("Accessible") : t("Blocked"), tone: editableSettings.sprintPreview.allowDockerAccess ? "warning" : "active" },
          { label: t("Default"), value: t("Off") },
          { label: t("Risk"), value: t("Host-level control") },
        ]}
      >
        <Row
          label={t("Allow Docker access")}
          description={t("Mount the host Docker daemon socket and a compatible local Docker CLI into preview containers. Disabled by default.")}
          badge={getFieldBadge("sprintPreview.allowDockerAccess")}
          last
        >
          <div className="flex w-full max-w-xl flex-col gap-3">
            <Toggle aria-label={t("Allow preview containers to control Docker")} value={editableSettings.sprintPreview.allowDockerAccess ?? false} onChange={() => updateEditableSettings((current) => ({
              ...current,
              sprintPreview: {
                ...current.sprintPreview,
                allowDockerAccess: !current.sprintPreview.allowDockerAccess,
              },
            }))} />
            <div className="flex gap-2 rounded-xl border border-status-amber/30 bg-status-amber/10 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:text-amber-200" role="note">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {t("Docker daemon access is equivalent to host-level control. Enable it only for trusted repositories and startup commands.")}
            </div>
          </div>
        </Row>
      </SectionCard>

      <SectionCard
        title={t("Preview Environment")}
        watermark="ENV"
        badge={getBadge("sprintPreview.environmentVariables")}
        icon={<SlidersHorizontal strokeWidth={2.4} />}
        highlights={[
          { label: t("Variables"), value: t("{count} configured", { count: editableSettings.sprintPreview.environmentVariables?.length ?? 0 }), tone: (editableSettings.sprintPreview.environmentVariables?.length ?? 0) > 0 ? "active" : "neutral" },
          { label: t("Scope"), value: activeScope === "project" ? t("Project") : t("System") },
          { label: t("Overrides"), value: t("Per container") },
        ]}
      >
        <Row
          label={t("Default container variables")}
          description={t("Environment variables injected into every preview container for this scope. Selected containers can override these from the Browser page.")}
          badge={getFieldBadge("sprintPreview.environmentVariables")}
          last
        >
          <PreviewEnvironmentEditor
            variables={editableSettings.sprintPreview.environmentVariables ?? []}
            onChange={(environmentVariables) => updateEditableSettings((current) => ({
              ...current,
              sprintPreview: {
                ...current.sprintPreview,
                environmentVariables,
              },
            }))}
            addLabel={t("Add default")}
            valueLabel={t("Preview environment default value")}
          />
        </Row>
      </SectionCard>
    </div>
  );
};
