import { createLazyFileRoute } from '@tanstack/react-router'
import DeveloperMcpToolsContent from '../content/docs/developer-mcp-tools.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/developer-mcp-tools')({
  component: () => (
    <DocsPage id="developer-mcp-tools">
      <DeveloperMcpToolsContent />
    </DocsPage>
  )
})
