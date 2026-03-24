import re
import sys

with open("dashboard/src/v2/components/ui/SprintComposer.tsx", "r") as f:
    content = f.read()

# Add planningEta to props interface
props_search = """  planningPresets: AgentPreset[];
  onClose: () => void;"""
props_replace = """  planningPresets: AgentPreset[];
  planningEta: number;
  onClose: () => void;"""
content = content.replace(props_search, props_replace)

# Update imports
content = content.replace(
  """import {\n  useSprintComposerState, \n  type SprintSubmitMode,\n  type PlanningRouteOption,\n  toPlanningOverrides,\n}""",
  """import {\n  useSprintComposerState, \n  type SprintSubmitMode,\n  type PlanningRouteOption,\n  toPlanningOverrides,\n  resolveSubmitOriginalPrompt,\n}"""
)

# Destructure planningEta
destruct_search = """  planningPresets,
  onClose,
  onImprovePrompt,
  onSubmit,"""
destruct_replace = """  planningPresets,
  planningEta,
  onClose,
  onImprovePrompt,
  onSubmit,"""
content = content.replace(destruct_search, destruct_replace)

# Modify handleSubmit
submit_search = """    try {
      await onSubmit({
        name: state.name.trim(),
        goal: state.goal.trim(),
        originalPrompt: state.originalPrompt,"""
submit_replace = """    try {
      await onSubmit({
        name: state.name.trim(),
        goal: state.goal.trim(),
        originalPrompt: resolveSubmitOriginalPrompt(state.submitMode, state.originalPrompt, state.goal),"""
content = content.replace(submit_search, submit_replace)

# Modify grid layout
grid_search = """            <div className="grid gap-4 xl:grid-cols-2">"""
grid_replace = """            <div className={state.originalPrompt ? "grid gap-4 xl:grid-cols-2" : "grid gap-4"}>"""
content = content.replace(grid_search, grid_replace)

# Add timer block to feedback
timer_search = """            </div>
            <h3 className="font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              {feedback.text}
            </h3>"""
timer_replace = """            </div>
            <div className="flex items-center justify-center gap-6">
              <div className="flex flex-col items-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">ETA</div>
                <div className="font-mono text-xl font-medium tracking-tight text-slate-900 dark:text-white">
                  {Math.floor(Math.max(0, planningEta - elapsedMs) / 60000)}:{String(Math.floor((Math.max(0, planningEta - elapsedMs) % 60000) / 1000)).padStart(2, '0')}
                </div>
              </div>
              <div className="h-8 w-px bg-black/[0.08] dark:bg-white/[0.08]" />
              <div className="flex flex-col items-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Elapsed</div>
                <div className="font-mono text-xl font-medium tracking-tight text-slate-500">
                  {Math.floor(elapsedMs / 60000)}:{String(Math.floor((elapsedMs % 60000) / 1000)).padStart(2, '0')}
                </div>
              </div>
            </div>
            <h3 className="font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              {feedback.text}
            </h3>"""
content = content.replace(timer_search, timer_replace)

with open("dashboard/src/v2/components/ui/SprintComposer.tsx", "w") as f:
    f.write(content)

print("Patch applied")
