import re

with open("dashboard/src/v2/lib/sprint-composer-state.ts", "r") as f:
    content = f.read()

helper = """
export function resolveSubmitOriginalPrompt(
  submitMode: SprintSubmitMode,
  originalPrompt: string | null,
  goal: string,
): string | null {
  const isPlanning = submitMode === "plan_only" || submitMode === "plan_and_start";
  if (isPlanning && !originalPrompt) {
    return goal.trim() || null;
  }
  return originalPrompt;
}
"""

content = content + helper

with open("dashboard/src/v2/lib/sprint-composer-state.ts", "w") as f:
    f.write(content)
