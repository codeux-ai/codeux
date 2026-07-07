import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardSchedulerContent from '../content/docs/user-dashboard-scheduler.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-scheduler')({
  component: () => (
    <DocsPage id="user-dashboard-scheduler">
      <UserDashboardSchedulerContent />
    </DocsPage>
  )
})
