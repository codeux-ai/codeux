import re

with open("docs/dashboard/dashboard-guide.md", "r") as f:
    content = f.read()

# Replace existing composer bullet
search_text = "- The sprint composer supports `Plan & Start`, `Plan Only`, and `Save Draft`."
replace_text = """- The sprint composer supports `Plan & Start`, `Plan Only`, and `Save Draft`.
- The sprint composer prompt area renders a full-width editor until an original prompt exists, at which point it uses a split layout.
- When planning a sprint (`Plan Only` or `Plan & Start`), the pre-improvement raw prompt is saved to `originalPrompt` if it isn't already set, keeping the worker-improved text as the goal.
- The planning feedback overlay surfaces both an ETA countdown and an elapsed runtime timer. The ETA is derived from project planning telemetry (averaging active time per planning invocation) with a 3:00 fallback."""
content = content.replace(search_text, replace_text)

with open("docs/dashboard/dashboard-guide.md", "w") as f:
    f.write(content)
