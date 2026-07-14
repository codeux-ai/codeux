import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureChatConnectorsOverviewContent from '../content/docs/architecture-chat-connectors-overview.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-chat-connectors-overview')({
  component: () => (
    <DocsPage id="architecture-chat-connectors-overview">
      <ArchitectureChatConnectorsOverviewContent />
    </DocsPage>
  )
})
