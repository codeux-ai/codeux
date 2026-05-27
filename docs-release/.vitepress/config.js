export default {
  title: 'Docs Release',
  description: 'Documentation site for releases',
  themeConfig: {
    sidebar: [
      { text: 'Get Started', collapsed: false, items: [
        { text: 'Overview', link: '/getting-started/overview' },
        { text: 'Create First Project', link: '/getting-started/first-project' }
      ] },
      { text: 'Installation', collapsed: false, items: [{ text: 'Overview', link: '/installation/overview' }] },
      { text: 'Guides', collapsed: false, items: [{ text: 'Overview', link: '/guides/overview' }, { text: 'Notifications', link: '/guides/notifications' }] },
      { text: 'Integrations', collapsed: false, items: [{ text: 'Overview', link: '/integrations/overview' }] },
      { text: 'Admin', collapsed: false, items: [{ text: 'Overview', link: '/admin/overview' }, { text: 'Audit Logs', link: '/admin/audit-logs' }] },
      { text: 'Troubleshooting', collapsed: false, items: [{ text: 'Overview', link: '/troubleshooting/overview' }] },
      { text: 'Reference', collapsed: false, items: [{ text: 'Overview', link: '/reference/overview' }] },
      { text: 'Release Notes', collapsed: false, items: [{ text: 'Overview', link: '/release-notes/overview' }] }
    ]
  }
}
