import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureCustomNodesContent from '../content/docs/architecture-custom-nodes.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-custom-nodes')({
  component: () => (
    <DocsPage id="architecture-custom-nodes">
      <ArchitectureCustomNodesContent />
    </DocsPage>
  )
})
