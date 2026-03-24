import re

with open("dashboard/src/v2/pages/sprints/SprintsPage.tsx", "r") as f:
    content = f.read()

destruct_search = """    virtualProviders,
    planningPresets,"""
destruct_replace = """    virtualProviders,
    planningEta,
    planningPresets,"""
content = content.replace(destruct_search, destruct_replace)

with open("dashboard/src/v2/pages/sprints/SprintsPage.tsx", "w") as f:
    f.write(content)
