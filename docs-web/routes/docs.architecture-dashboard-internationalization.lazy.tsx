import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureDashboardInternationalizationContent from '../content/docs/architecture-dashboard-internationalization.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-dashboard-internationalization')({
  component: () => (
    <DocsPage id="architecture-dashboard-internationalization">
      <ArchitectureDashboardInternationalizationContent />
    </DocsPage>
  )
})
