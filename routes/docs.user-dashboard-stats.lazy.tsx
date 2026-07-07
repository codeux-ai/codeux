import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardStatsContent from '../content/docs/user-dashboard-stats.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-stats')({
  component: () => (
    <DocsPage id="user-dashboard-stats">
      <UserDashboardStatsContent />
    </DocsPage>
  )
})
