export default {
  title: 'Code UX',
  description: 'Documentation for Code UX — the open-source, container-first agentic coding runtime.',
  cleanUrls: true,
  // The local dashboard address is documented, not a browsable page.
  ignoreDeadLinks: [/^https?:\/\/localhost/],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/user/introduction' },
      { text: 'Reference', link: '/developer/' },
      { text: 'Architecture', link: '/architecture/' },
      {
        text: 'Download',
        items: [
          { text: 'GitHub Releases', link: 'https://github.com/codeux-ai/codeux/releases/latest' },
          { text: 'npm package', link: 'https://www.npmjs.com/package/@codeuxai/codeux' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/codeux-ai/codeux' },
    ],
    editLink: {
      pattern: 'https://github.com/codeux-ai/codeux/edit/main/docs-web/:path',
    },
    search: {
      provider: 'local',
      options: {
        miniSearch: {
          searchOptions: { fuzzy: 0.2 },
        },
      },
    },
    sidebar: [
      {
        text: 'User Guide',
        collapsed: false,
        items: [
          { text: 'Introduction', link: '/user/introduction' },
          { text: 'Installation', link: '/user/installation' },
          { text: 'Quickstart', link: '/user/quickstart' },
          { text: 'Providers & Models', link: '/user/providers-and-models' },
          { text: 'Sprint Orchestration', link: '/user/sprint-orchestration' },
          { text: 'Quicksprints', link: '/user/quicksprints' },
          { text: 'Automation & CI', link: '/user/automation-and-ci' },
          { text: 'MCP Clients', link: '/user/mcp-clients' },
          { text: 'Troubleshooting', link: '/user/troubleshooting' },
        ],
      },
      {
        text: 'Dashboard',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/user/dashboard/overview' },
          { text: 'Projects', link: '/user/dashboard/projects' },
          { text: 'Sprints', link: '/user/dashboard/sprints' },
          { text: 'Tasks', link: '/user/dashboard/tasks' },
          { text: 'Live Session', link: '/user/dashboard/live-session' },
          { text: 'Agents', link: '/user/dashboard/agents' },
          { text: 'Chat', link: '/user/dashboard/chat' },
          { text: 'Scheduler', link: '/user/dashboard/scheduler' },
          { text: 'Memory', link: '/user/dashboard/memory' },
          { text: 'Knowledge', link: '/user/dashboard/knowledge' },
          { text: 'File Browser', link: '/user/dashboard/file-browser' },
          { text: 'Stats', link: '/user/dashboard/stats' },
          { text: 'Settings', link: '/user/dashboard/settings' },
          { text: 'Browser Preview', link: '/user/dashboard/browser-preview' },
        ],
      },
      {
        text: 'Developer Reference',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/developer/' },
          { text: 'Configuration', link: '/developer/configuration' },
          { text: 'Settings Reference', link: '/developer/settings-reference' },
          { text: 'HTTP API', link: '/developer/http-api' },
          { text: 'WebSocket Realtime', link: '/developer/websocket-realtime' },
          { text: 'MCP Tools', link: '/developer/mcp-tools' },
          { text: 'Management Actions', link: '/developer/management-actions' },
          { text: 'Sprint Format', link: '/developer/sprint-format' },
          { text: 'Building from Source', link: '/developer/building-from-source' },
          { text: 'Testing', link: '/developer/testing' },
        ],
      },
      {
        text: 'Architecture',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/architecture/' },
          { text: 'System Overview', link: '/architecture/system-overview' },
          { text: 'Sprint Engine', link: '/architecture/sprint-engine' },
          { text: 'Data Model', link: '/architecture/data-model' },
          { text: 'Configuration Resolution', link: '/architecture/configuration-resolution' },
          { text: 'MCP Server', link: '/architecture/mcp-server' },
          { text: 'Virtual Workers', link: '/architecture/virtual-workers' },
          { text: 'CI Integration', link: '/architecture/ci-integration' },
          { text: 'Dashboard Architecture', link: '/architecture/dashboard-architecture' },
          { text: 'Security', link: '/architecture/security' },
        ],
      },
    ],
  },
}
