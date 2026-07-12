import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureNodeFlowFoundationContent from '../content/docs/architecture-node-flow-foundation.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-node-flow-foundation')({
  component: () => (
    <DocsPage id="architecture-node-flow-foundation">
      <ArchitectureNodeFlowFoundationContent />
    </DocsPage>
  )
})
