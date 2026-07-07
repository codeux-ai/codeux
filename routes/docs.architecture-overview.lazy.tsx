import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureOverviewContent from '../content/docs/architecture-overview.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-overview')({
  component: () => (
    <DocsPage id="architecture-overview">
      <ArchitectureOverviewContent />
    </DocsPage>
  )
})
