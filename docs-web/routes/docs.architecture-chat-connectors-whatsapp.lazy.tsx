import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureChatConnectorsWhatsappContent from '../content/docs/architecture-chat-connectors-whatsapp.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-chat-connectors-whatsapp')({
  component: () => (
    <DocsPage id="architecture-chat-connectors-whatsapp">
      <ArchitectureChatConnectorsWhatsappContent />
    </DocsPage>
  )
})
