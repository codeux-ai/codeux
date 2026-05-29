export default {
  title: 'Docs Release',
  description: 'Documentation site for releases',
  themeConfig: {
    search: {
      provider: 'local',
      options: {
        miniSearch: {
          options: {
            processTerm: (term) => {
              const synonyms = {
                'guide': ['guide', 'manual', 'help'],
                'task': ['task', 'guide'],
                'troubleshooting': ['troubleshooting', 'fix', 'error', 'debug'],
                'troubleshoot': ['troubleshoot', 'debug'],
                'debug': ['debug', 'troubleshoot']
              };
              const lower = term.toLowerCase();
              return synonyms[lower] || lower;
            }
          },
          searchOptions: {
            fuzzy: 0.2
          }
        }
      }
    },
    sidebar: [
      { text: 'Get Started', collapsed: false, items: [
        { text: 'Overview', link: '/getting-started/overview' },
        { text: 'Create First Project', link: '/getting-started/first-project' }
      ] },
      { text: 'Installation', collapsed: false, items: [{ text: 'Overview', link: '/installation/overview' }] },
<<<<<<< HEAD
      { text: 'Guides', collapsed: false, items: [{ text: 'Overview', link: '/guides/overview' }, { text: 'Notifications', link: '/guides/notifications' }] },
      { text: 'Integrations', collapsed: false, items: [{ text: 'Overview', link: '/integrations/overview' }, { text: 'MCP Setup', link: '/integrations/mcp-setup' }] },
      { text: 'Admin', collapsed: false, items: [{ text: 'Overview', link: '/admin/overview' }, { text: 'Audit Logs', link: '/admin/audit-logs' }] },
      { text: 'Troubleshooting', collapsed: false, items: [{ text: 'Overview', link: '/troubleshooting/overview' }] },
      { text: 'Reference', collapsed: false, items: [{ text: 'Overview', link: '/reference/overview' }, { text: 'Supported Platforms', link: '/reference/supported-platforms' }] },
      { text: 'Release Notes', collapsed: false, items: [{ text: 'Overview', link: '/release-notes/overview' }] }
    ]
  }
}
