import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureSystemOverviewContent from '../content/docs/architecture-system-overview.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-system-overview')({
  component: () => (
    <DocsPage id="architecture-system-overview">
      <ArchitectureSystemOverviewContent />
    </DocsPage>
  )
})
