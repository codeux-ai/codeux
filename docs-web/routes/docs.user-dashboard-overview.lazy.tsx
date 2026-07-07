import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardOverviewContent from '../content/docs/user-dashboard-overview.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-overview')({
  component: () => (
    <DocsPage id="user-dashboard-overview">
      <UserDashboardOverviewContent />
    </DocsPage>
  )
})
