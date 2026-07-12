import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureNodeFlowsContent from '../content/docs/architecture-node-flows.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-node-flows')({
  component: () => (
    <DocsPage id="architecture-node-flows">
      <ArchitectureNodeFlowsContent />
    </DocsPage>
  )
})
