import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardInteractionPatternsContent from '../content/docs/user-dashboard-interaction-patterns.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-interaction-patterns')({
  component: () => (
    <DocsPage id="user-dashboard-interaction-patterns">
      <UserDashboardInteractionPatternsContent />
    </DocsPage>
  )
})
