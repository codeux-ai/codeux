import re

with open('dashboard/src/v2/SettingsPage.tsx', 'r') as f:
    content = f.read()

# Make Save Changes button row sticky on mobile
content = content.replace(
    '<div className="mt-4 flex flex-wrap items-center gap-3">',
    '<div className="mt-4 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 fixed bottom-0 left-0 right-0 z-50 bg-white/90 dark:bg-void-900/90 p-4 border-t border-black/10 dark:border-white/10 md:static md:bg-transparent md:dark:bg-transparent md:border-none md:p-0">'
)

content = content.replace(
    '<ActionButton\n                label="Reset Project"\n                onClick={() => void handleResetProject()}\n                tone="danger"\n                busy={resettingProject}\n                disabled={!selectedProject}\n              />',
    '<ActionButton\n                className="w-full sm:w-auto"\n                label="Reset Project"\n                onClick={() => void handleResetProject()}\n                tone="danger"\n                busy={resettingProject}\n                disabled={!selectedProject}\n              />'
)

# And make the main save button full width on mobile
content = content.replace(
    'className={`group inline-flex items-center gap-2.5 rounded-2xl px-5 py-3 text-sm font-bold transition-[background-color,box-shadow,transform] duration-300 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50',
    'className={`group w-full sm:w-auto justify-center inline-flex items-center gap-2.5 rounded-2xl px-5 py-3 text-sm font-bold transition-[background-color,box-shadow,transform] duration-300 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50'
)

with open('dashboard/src/v2/SettingsPage.tsx', 'w') as f:
    f.write(content)
