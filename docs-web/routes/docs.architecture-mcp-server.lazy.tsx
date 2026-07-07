import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureMcpServerContent from '../content/docs/architecture-mcp-server.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-mcp-server')({
  component: () => (
    <DocsPage id="architecture-mcp-server">
      <ArchitectureMcpServerContent />
    </DocsPage>
  )
})
