import re

with open("dashboard/src/v2/pages/sprints/use-sprints-page-data.ts", "r") as f:
    content = f.read()

return_search = """    virtualProviders,
    planningPresets,"""
return_replace = """    virtualProviders,
    planningEta,
    planningPresets,"""
content = content.replace(return_search, return_replace)

with open("dashboard/src/v2/pages/sprints/use-sprints-page-data.ts", "w") as f:
    f.write(content)
