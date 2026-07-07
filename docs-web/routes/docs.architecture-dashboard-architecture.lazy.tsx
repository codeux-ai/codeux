import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureDashboardArchitectureContent from '../content/docs/architecture-dashboard-architecture.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-dashboard-architecture')({
  component: () => (
    <DocsPage id="architecture-dashboard-architecture">
      <ArchitectureDashboardArchitectureContent />
    </DocsPage>
  )
})
