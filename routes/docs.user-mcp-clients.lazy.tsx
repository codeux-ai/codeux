import { createLazyFileRoute } from '@tanstack/react-router'
import UserMcpClientsContent from '../content/docs/user-mcp-clients.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-mcp-clients')({
  component: () => (
    <DocsPage id="user-mcp-clients">
      <UserMcpClientsContent />
    </DocsPage>
  )
})
