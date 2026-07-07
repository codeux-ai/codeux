import { createLazyFileRoute } from '@tanstack/react-router'
import UserOverviewContent from '../content/docs/user-overview.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-overview')({
  component: () => (
    <DocsPage id="user-overview">
      <UserOverviewContent />
    </DocsPage>
  )
})
