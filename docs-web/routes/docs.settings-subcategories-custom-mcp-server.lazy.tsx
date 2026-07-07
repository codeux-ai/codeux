import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesCustomMcpServerContent from '../content/docs/settings-subcategories-custom-mcp-server.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-custom-mcp-server')({
  component: () => (
    <DocsPage id="settings-subcategories-custom-mcp-server">
      <SettingsSubcategoriesCustomMcpServerContent />
    </DocsPage>
  )
})
