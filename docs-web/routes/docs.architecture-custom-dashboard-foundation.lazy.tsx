import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureCustomDashboardFoundationContent from '../content/docs/architecture-custom-dashboard-foundation.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-custom-dashboard-foundation')({
  component: () => (
    <DocsPage id="architecture-custom-dashboard-foundation">
      <ArchitectureCustomDashboardFoundationContent />
    </DocsPage>
  )
})
