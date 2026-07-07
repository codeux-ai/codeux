import { createLazyFileRoute } from '@tanstack/react-router'
import DocsOverviewContent from '../content/docs/docs-overview.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/docs-overview')({
  component: () => (
    <DocsPage id="docs-overview">
      <DocsOverviewContent />
    </DocsPage>
  )
})
