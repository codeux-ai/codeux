import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureChatConnectorRuntimeReliabilityContent from '../content/docs/architecture-chat-connector-runtime-reliability.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-chat-connector-runtime-reliability')({
  component: () => (
    <DocsPage id="architecture-chat-connector-runtime-reliability">
      <ArchitectureChatConnectorRuntimeReliabilityContent />
    </DocsPage>
  )
})
