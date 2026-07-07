import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesMcpToolCategoryContent from '../content/docs/settings-subcategories-mcp-tool-category.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-mcp-tool-category')({
  component: () => (
    <DocsPage id="settings-subcategories-mcp-tool-category">
      <SettingsSubcategoriesMcpToolCategoryContent />
    </DocsPage>
  )
})
