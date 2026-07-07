import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesBuiltInMcpContent from '../content/docs/settings-subcategories-built-in-mcp.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-built-in-mcp')({
  component: () => (
    <DocsPage id="settings-subcategories-built-in-mcp">
      <SettingsSubcategoriesBuiltInMcpContent />
    </DocsPage>
  )
})
