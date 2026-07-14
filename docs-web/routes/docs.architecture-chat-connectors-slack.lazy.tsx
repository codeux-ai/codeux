import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureChatConnectorsSlackContent from '../content/docs/architecture-chat-connectors-slack.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-chat-connectors-slack')({
  component: () => (
    <DocsPage id="architecture-chat-connectors-slack">
      <ArchitectureChatConnectorsSlackContent />
    </DocsPage>
  )
})
