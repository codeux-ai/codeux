import re

with open("dashboard/src/v2/pages/sprints/use-sprints-page-data.ts", "r") as f:
    content = f.read()

# Add imports
import_telemetry = """import { derivePlanningETA } from "../../lib/planning-telemetry.js";\nimport { fetchProjectEffectiveSettings } from "../../lib/settings-api.js";"""
content = content.replace('import { fetchProjectEffectiveSettings } from "../../lib/settings-api.js";', import_telemetry)

import_stats = """  fetchProjectExecution,\n  fetchProjectStats,\n"""
content = content.replace('  fetchProjectExecution,\n', import_stats)

# Add state
state_search = """  const [agentPresets, setAgentPresets] = useState<AgentPreset[]>([]);"""
state_replace = """  const [agentPresets, setAgentPresets] = useState<AgentPreset[]>([]);
  const [planningEta, setPlanningEta] = useState(180000);"""
content = content.replace(state_search, state_replace)

# Add effect
effect_search = """  useEffect(() => {
    let cancelled = false;

    if (!selectedProject) {
      setWorkerMode(null);"""
effect_replace = """  useEffect(() => {
    if (!selectedProject) {
      setPlanningEta(180000);
      return;
    }
    let cancelled = false;
    void fetchProjectStats(selectedProject.id, "all")
      .then((stats) => {
        if (!cancelled) setPlanningEta(derivePlanningETA(stats));
      })
      .catch((error) => {
        console.error("Failed to fetch project stats for ETA", error);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProject?.id]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedProject) {
      setWorkerMode(null);"""
content = content.replace(effect_search, effect_replace)

# Add return value
return_search = """    virtualProviders,
    handleSprintToggle,
    handleDeleteSprint,
    handleToggleShowcase,
    handleSubmitSprint,"""
return_replace = """    virtualProviders,
    planningEta,
    handleSprintToggle,
    handleDeleteSprint,
    handleToggleShowcase,
    handleSubmitSprint,"""
content = content.replace(return_search, return_replace)

with open("dashboard/src/v2/pages/sprints/use-sprints-page-data.ts", "w") as f:
    f.write(content)
