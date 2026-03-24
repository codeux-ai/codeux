import re

with open("dashboard/src/v2/pages/sprints/SprintsPage.tsx", "r") as f:
    content = f.read()

destruct_search = """    virtualProviders,
    handleSprintToggle,"""
destruct_replace = """    virtualProviders,
    planningEta,
    handleSprintToggle,"""
content = content.replace(destruct_search, destruct_replace)

composer_search = """                    virtualProviders={virtualProviders}
                    planningPresets={planningPresets}
                    onClose={() => {"""
composer_replace = """                    virtualProviders={virtualProviders}
                    planningPresets={planningPresets}
                    planningEta={planningEta}
                    onClose={() => {"""
content = content.replace(composer_search, composer_replace)

with open("dashboard/src/v2/pages/sprints/SprintsPage.tsx", "w") as f:
    f.write(content)
