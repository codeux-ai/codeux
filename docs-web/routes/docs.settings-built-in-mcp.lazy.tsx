import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsBuiltInMcpContent from '../content/docs/settings-built-in-mcp.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-built-in-mcp')({
  component: () => (
    <DocsPage id="settings-built-in-mcp">
      <SettingsBuiltInMcpContent />
    </DocsPage>
  )
})
