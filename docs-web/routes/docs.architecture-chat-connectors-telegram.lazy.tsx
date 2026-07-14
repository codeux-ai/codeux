import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureChatConnectorsTelegramContent from '../content/docs/architecture-chat-connectors-telegram.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-chat-connectors-telegram')({
  component: () => (
    <DocsPage id="architecture-chat-connectors-telegram">
      <ArchitectureChatConnectorsTelegramContent />
    </DocsPage>
  )
})
