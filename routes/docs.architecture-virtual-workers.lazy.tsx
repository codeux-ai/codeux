import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureVirtualWorkersContent from '../content/docs/architecture-virtual-workers.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-virtual-workers')({
  component: () => (
    <DocsPage id="architecture-virtual-workers">
      <ArchitectureVirtualWorkersContent />
    </DocsPage>
  )
})
