import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureChatConnectorsImessageContent from '../content/docs/architecture-chat-connectors-imessage.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-chat-connectors-imessage')({
  component: () => (
    <DocsPage id="architecture-chat-connectors-imessage">
      <ArchitectureChatConnectorsImessageContent />
    </DocsPage>
  )
})
