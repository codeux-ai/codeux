import type { FunctionComponent } from "preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { NumberInput, Row, TextInput, Toggle } from "../SettingsFormFields.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";

export const SettingsBrowserPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
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
    <div className="flex flex-col gap-5">
      <SectionCard title="Workspace Visibility" watermark="WEB" badge={getBadge("sprintPreview")}>
        <Row label="Preview runtime enabled" description="Allow Sprint OS to launch, rebuild, and reconcile preview containers for this scope." badge={getFieldBadge("sprintPreview.enabled")}>
          <Toggle value={editableSettings.sprintPreview.enabled} onChange={() => updateEditableSettings((current) => ({
            ...current,
            sprintPreview: {
              ...current.sprintPreview,
              enabled: !current.sprintPreview.enabled,
            },
          }))} />
        </Row>
        <Row label="Show in-app browser workspace" description="Expose Browser entry points in the dashboard and allow the embedded preview workspace to render." badge={getFieldBadge("sprintPreview.showInAppBrowser")}>
          <Toggle value={editableSettings.sprintPreview.showInAppBrowser} onChange={() => updateEditableSettings((current) => ({
            ...current,
            sprintPreview: {
              ...current.sprintPreview,
              showInAppBrowser: !current.sprintPreview.showInAppBrowser,
            },
          }))} />
        </Row>
        <Row label="Launch preview when sprint starts" description="Start a preview container automatically when Sprint OS detects the sprint is actively running." badge={getFieldBadge("sprintPreview.autoStartOnRunningSprint")}>
          <Toggle value={editableSettings.sprintPreview.autoStartOnRunningSprint} onChange={() => updateEditableSettings((current) => ({
            ...current,
            sprintPreview: {
              ...current.sprintPreview,
              autoStartOnRunningSprint: !current.sprintPreview.autoStartOnRunningSprint,
            },
          }))} />
        </Row>
        <Row label="Rebuild preview on task completion" description="Refresh the active preview after a task finishes so the container reflects the latest sprint output." badge={getFieldBadge("sprintPreview.rebuildOnTaskCompletion")}>
          <Toggle value={editableSettings.sprintPreview.rebuildOnTaskCompletion} onChange={() => updateEditableSettings((current) => ({
            ...current,
            sprintPreview: {
              ...current.sprintPreview,
              rebuildOnTaskCompletion: !current.sprintPreview.rebuildOnTaskCompletion,
            },
          }))} />
        </Row>
        <Row label="Rebuild preview on sprint completion" description="Run one final rebuild when the sprint reaches its completed terminal state." badge={getFieldBadge("sprintPreview.rebuildOnSprintCompletion")}>
          <Toggle value={editableSettings.sprintPreview.rebuildOnSprintCompletion} onChange={() => updateEditableSettings((current) => ({
            ...current,
            sprintPreview: {
              ...current.sprintPreview,
              rebuildOnSprintCompletion: !current.sprintPreview.rebuildOnSprintCompletion,
            },
          }))} />
        </Row>
        <Row label="Pull latest Git changes before rebuild" description="Sync the latest remote branch state into rebuild exports so preview containers pick up newly pushed sprint changes." badge={getFieldBadge("sprintPreview.pullLatestOnRebuild")}>
          <Toggle value={editableSettings.sprintPreview.pullLatestOnRebuild} onChange={() => updateEditableSettings((current) => ({
            ...current,
            sprintPreview: {
              ...current.sprintPreview,
              pullLatestOnRebuild: !current.sprintPreview.pullLatestOnRebuild,
            },
          }))} />
        </Row>
        <Row label="Stop preview when sprint ends" description="Shut down the preview container automatically when the sprint finishes, fails, or is cancelled." badge={getFieldBadge("sprintPreview.autoStopOnTerminalSprint")} last>
          <Toggle value={editableSettings.sprintPreview.autoStopOnTerminalSprint} onChange={() => updateEditableSettings((current) => ({
            ...current,
            sprintPreview: {
              ...current.sprintPreview,
              autoStopOnTerminalSprint: !current.sprintPreview.autoStopOnTerminalSprint,
            },
          }))} />
        </Row>
      </SectionCard>

      <SectionCard title="Runtime Limits" watermark="PORT" badge={getBadge("sprintPreview")}>
        <Row label="Maximum active preview containers" description="When this cap is exceeded, Sprint OS stops the oldest active previews before launching the next one." badge={getFieldBadge("sprintPreview.maxConcurrentContainers")}>
          <NumberInput
            value={editableSettings.sprintPreview.maxConcurrentContainers}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              sprintPreview: {
                ...current.sprintPreview,
                maxConcurrentContainers: value,
              },
            }))}
            min={1}
            max={100}
          />
        </Row>
        <Row label="Host port range start" description="Lower bound for preview host-port allocation. Preview ports bind to localhost only." badge={getFieldBadge("sprintPreview.hostPortRangeStart")}>
          <NumberInput
            value={editableSettings.sprintPreview.hostPortRangeStart}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              sprintPreview: {
                ...current.sprintPreview,
                hostPortRangeStart: value,
              },
            }))}
            min={1}
            max={65535}
          />
        </Row>
        <Row label="Host port range end" description="Upper bound for preview host-port allocation." badge={getFieldBadge("sprintPreview.hostPortRangeEnd")}>
          <NumberInput
            value={editableSettings.sprintPreview.hostPortRangeEnd}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              sprintPreview: {
                ...current.sprintPreview,
                hostPortRangeEnd: value,
              },
            }))}
            min={1}
            max={65535}
          />
        </Row>
        <Row label="Container app port" description="Internal port the preview app listens on inside the container before Sprint OS maps it to a host port." badge={getFieldBadge("sprintPreview.containerAppPort")}>
          <NumberInput
            value={editableSettings.sprintPreview.containerAppPort}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              sprintPreview: {
                ...current.sprintPreview,
                containerAppPort: value,
              },
            }))}
            min={1}
            max={65535}
          />
        </Row>
        <Row label="Startup script path" description="Project-relative path used for the editable preview startup override script." badge={getFieldBadge("sprintPreview.startupScriptPath")} last>
          <TextInput
            value={editableSettings.sprintPreview.startupScriptPath}
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
      </SectionCard>
    </div>
  );
};
