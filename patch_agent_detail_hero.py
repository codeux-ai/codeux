import re

with open('dashboard/src/v2/components/agents/AgentPresetDetailPanel.tsx', 'r') as f:
    content = f.read()

# Make the header stack on small screens
content = content.replace(
    '<div className="flex items-start justify-between gap-4">',
    '<div className="flex flex-col md:flex-row md:items-start justify-between gap-4">'
)
# Make the edit button full width on small screens
content = content.replace(
    'className="inline-flex items-center gap-2 rounded-full bg-signal-500',
    'className="inline-flex w-full md:w-auto justify-center items-center gap-2 rounded-full bg-signal-500'
)

# And action buttons
content = content.replace(
    'className="mt-4 flex flex-wrap items-center gap-3 border-t border-black/5 pt-6 dark:border-white/5"',
    'className="mt-4 flex flex-col md:flex-row md:flex-wrap items-stretch md:items-center gap-3 border-t border-black/5 pt-6 dark:border-white/5"'
)

content = content.replace(
    'className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-signal-600 transition-colors hover:bg-signal-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-signal-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"',
    'className="inline-flex justify-center items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-signal-600 transition-colors hover:bg-signal-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-signal-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"'
)

content = content.replace(
    'className="inline-flex items-center gap-2 rounded-full border border-status-red/20 bg-status-red/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-status-red transition-colors hover:bg-status-red/20 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"',
    'className="inline-flex justify-center items-center gap-2 rounded-full border border-status-red/20 bg-status-red/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-status-red transition-colors hover:bg-status-red/20 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"'
)


with open('dashboard/src/v2/components/agents/AgentPresetDetailPanel.tsx', 'w') as f:
    f.write(content)

with open('dashboard/src/v2/components/agents/AgentsHero.tsx', 'r') as f:
    hero_content = f.read()

hero_content = hero_content.replace(
    '<div className="mt-4 flex flex-wrap gap-4">',
    '<div className="mt-4 flex flex-col md:flex-row flex-wrap items-stretch md:items-center gap-4">'
)
hero_content = hero_content.replace(
    'className="group inline-flex items-center gap-2 rounded-full bg-signal-500',
    'className="group inline-flex justify-center md:justify-start items-center gap-2 rounded-full bg-signal-500'
)
hero_content = hero_content.replace(
    'className="inline-flex items-center gap-2 rounded-full border border-white/10',
    'className="inline-flex justify-center md:justify-start items-center gap-2 rounded-full border border-white/10'
)


with open('dashboard/src/v2/components/agents/AgentsHero.tsx', 'w') as f:
    f.write(hero_content)
