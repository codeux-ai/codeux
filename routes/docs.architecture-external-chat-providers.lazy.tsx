import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureExternalChatProvidersContent from '../content/docs/architecture-external-chat-providers.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-external-chat-providers')({
  component: () => (
    <DocsPage id="architecture-external-chat-providers">
      <ArchitectureExternalChatProvidersContent />
    </DocsPage>
  )
})
