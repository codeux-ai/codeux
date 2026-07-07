import { createLazyFileRoute } from '@tanstack/react-router'
import DeveloperOverviewContent from '../content/docs/developer-overview.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/developer-overview')({
  component: () => (
    <DocsPage id="developer-overview">
      <DeveloperOverviewContent />
    </DocsPage>
  )
})
