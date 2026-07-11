import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsCustomMcpServerContent from '../content/docs/settings-custom-mcp-server.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-custom-mcp-server')({
  component: () => (
    <DocsPage id="settings-custom-mcp-server">
      <SettingsCustomMcpServerContent />
    </DocsPage>
  )
})
