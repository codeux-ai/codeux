import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsMcpToolCategoryContent from '../content/docs/settings-mcp-tool-category.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-mcp-tool-category')({
  component: () => (
    <DocsPage id="settings-mcp-tool-category">
      <SettingsMcpToolCategoryContent />
    </DocsPage>
  )
})
