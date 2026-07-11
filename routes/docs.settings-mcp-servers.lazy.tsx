import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsMcpServersContent from '../content/docs/settings-mcp-servers.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-mcp-servers')({
  component: () => (
    <DocsPage id="settings-mcp-servers">
      <SettingsMcpServersContent />
    </DocsPage>
  )
})
