import type { FunctionComponent } from "preact";
import type { McpToolToggle } from "../../types.js";
import { SettingsCard } from "./primitives.js";
import type { SettingsSectionProps } from "./types.js";

const updateMcpTool = (tools: McpToolToggle[], index: number, enabled: boolean): McpToolToggle[] => {
  return tools.map((tool, currentIndex) => (currentIndex === index ? { ...tool, enabled } : tool));
};

export const McpToolsSection: FunctionComponent<SettingsSectionProps> = ({ settings, onChange }) => (
  <SettingsCard
    title="MCP Tools"
    description="Controls which tools are listed and callable through MCP. Disabling a tool hides it and blocks calls at runtime."
  >
    <div className="space-y-3">
      {settings.mcpTools.length === 0 ? (
        <p className="text-sm text-slate-500">No MCP tools configured.</p>
      ) : (
        settings.mcpTools.map((tool, index) => (
          <label
            key={tool.name}
            className="flex items-center justify-between rounded-lg border border-slate-700/70 bg-slate-950/50 px-3 py-2"
          >
            <span className="text-sm text-slate-200">{tool.name}</span>
            <input
              type="checkbox"
              checked={tool.enabled}
              onChange={(event) =>
                onChange({
                  ...settings,
                  mcpTools: updateMcpTool(settings.mcpTools, index, event.currentTarget.checked),
                })
              }
              className="h-4 w-4 rounded border-slate-700 bg-slate-900"
            />
          </label>
        ))
      )}
    </div>
  </SettingsCard>
);
