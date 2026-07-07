import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardCustomDashboardsContent from '../content/docs/user-dashboard-custom-dashboards.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-custom-dashboards')({
  component: () => (
    <DocsPage id="user-dashboard-custom-dashboards">
      <UserDashboardCustomDashboardsContent />
    </DocsPage>
  )
})
