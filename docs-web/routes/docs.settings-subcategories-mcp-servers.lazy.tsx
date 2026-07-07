import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesMcpServersContent from '../content/docs/settings-subcategories-mcp-servers.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-mcp-servers')({
  component: () => (
    <DocsPage id="settings-subcategories-mcp-servers">
      <SettingsSubcategoriesMcpServersContent />
    </DocsPage>
  )
})
