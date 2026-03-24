import re
import sys

with open("dashboard/src/v2/SprintsPage.tsx", "r") as f:
    content = f.read()

# 1. Add imports
import_telemetry = """import { derivePlanningETA } from "./lib/planning-telemetry.js";\nimport { fetchProjectEffectiveSettings } from "./lib/settings-api.js";"""
content = content.replace('import { fetchProjectEffectiveSettings } from "./lib/settings-api.js";', import_telemetry)

import_stats = """  fetchProjectExecution,\n  fetchProjectStats,\n"""
content = content.replace('  fetchProjectExecution,\n', import_stats)

# 2. Add state
state_search = """  const [agentPresets, setAgentPresets] = useState<AgentPreset[]>([]);"""
state_replace = """  const [agentPresets, setAgentPresets] = useState<AgentPreset[]>([]);
  const [planningEta, setPlanningEta] = useState(180000);"""
content = content.replace(state_search, state_replace)

# 3. Add effect to fetch stats
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

# 4. Pass planningEta to SprintComposer
composer_search = """                    virtualProviders={virtualProviders}
                    planningPresets={planningPresets}
                    onClose={() => {"""
composer_replace = """                    virtualProviders={virtualProviders}
                    planningPresets={planningPresets}
                    planningEta={planningEta}
                    onClose={() => {"""
content = content.replace(composer_search, composer_replace)

with open("dashboard/src/v2/SprintsPage.tsx", "w") as f:
    f.write(content)

print("Patch applied")
