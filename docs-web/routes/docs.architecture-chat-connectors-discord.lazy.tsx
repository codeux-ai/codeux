import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureChatConnectorsDiscordContent from '../content/docs/architecture-chat-connectors-discord.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-chat-connectors-discord')({
  component: () => (
    <DocsPage id="architecture-chat-connectors-discord">
      <ArchitectureChatConnectorsDiscordContent />
    </DocsPage>
  )
})
