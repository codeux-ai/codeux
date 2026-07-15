import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureChatConnectorsMicrosoftTeamsContent from '../content/docs/architecture-chat-connectors-microsoft-teams.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-chat-connectors-microsoft-teams')({
  component: () => (
    <DocsPage id="architecture-chat-connectors-microsoft-teams">
      <ArchitectureChatConnectorsMicrosoftTeamsContent />
    </DocsPage>
  )
})
